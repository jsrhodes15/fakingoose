const Chance = require('chance');
const set = require('lodash.set');
const get = require('lodash.get');
const isPlainObject = require('lodash.isplainobject');
const ObjectId = require('bson-objectid');

const chance = new Chance();

function getOfType(of) {
  return of.name.toLowerCase();
}
function hasDefinedDefaultValue(pathDef) {
  return !!pathDef.options.default;
}

const generators = {
  string: (pathDef, options) => {
    if (Array.isArray(pathDef.enumValues) && pathDef.enumValues.length) {
      return chance.pickone(pathDef.enumValues);
    }
    if (options && options.type) {
      switch (options.type) {
        case 'email':
          return chance.email();
        case 'firstname':
          return chance.first();
        case 'lastname':
          return chance.last();
        default:
          return chance.string();
      }
    }
    return pathDef.lowercase ? chance.string().toLowerCase() : chance.string();
  },
  array: (pathDef, options, staticFields) => {
    const num = 2;
    if (typeof pathDef.caster === 'object') {
      const innerType = pathDef.caster.instance.toLowerCase();
      const generator = generators[innerType];

      return Array.from(Array(num)).map(() => generator(pathDef.options));
    } else if (typeof pathDef.caster === 'function') {
      // eslint-disable-next-line no-use-before-define
      return Array.from(Array(num)).map(() => generate(pathDef.schema, options, staticFields));
    }
    return null;
  },
  objectid: () => ObjectId(),
  number: (pathDef) => {
    const numOpt = ['min', 'max'].reduce((opts, att) => {
      if (pathDef.options && pathDef.options[att]) {
        const attrValue = Array.isArray(pathDef.options[att]) ? pathDef.options[att][0]
          : pathDef.options[att];
        return Object.assign(opts, { [att]: attrValue });
      }
      return opts;
    }, {});
    return chance.integer(numOpt);
  },
  decimal128: () => `${chance.floating()}`,
  boolean: () => chance.pickone([true, false]),
  date: () => new Date(),
  buffer: () => Buffer.alloc(1),
  mixed: (pathDef, options) => {
    const generatorName = chance.pickone(['boolean', 'date', 'number', 'string', 'objectid']);
    if (!generators[generatorName]) {
      throw new Error(`Type ${generatorName} not supported`);
    }
    return generators[generatorName](pathDef, options);
  },
  embedded: (pathDef, options, staticFields) => {
    const { schema } = pathDef;
    // eslint-disable-next-line no-use-before-define
    return generate(schema, options, staticFields);
  },
  map: (pathDef, options) => {
    const generatorName = pathDef.options.of ? getOfType(pathDef.options.of) : 'mixed';
    if (!generators[generatorName]) {
      throw new Error(`Type ${generatorName} not supported`);
    }
    const generator = generators[generatorName];
    const keyCount = chance.integer({ min: 1, max: 10 });
    const keys = Array.from(new Array(keyCount))
      .map(() => chance.string({ pool: 'abcdefghijklmnopqrstuvwxyz' }));
    const mock = keys.reduce(
      (obj, key) =>
        Object.assign(obj, { [key]: generator(pathDef, options) }),
      {},
    );
    return mock;
  },
};

function populateField(mockObject, schema, path, options, staticValue) {
  const fieldOptions = options[path] || {};
  if (!fieldOptions.skip) {
    let value;
    const pathDef = schema.path(path);
    // skip if default value is defined. Mongoose would take care of it
    if (!hasDefinedDefaultValue(pathDef)) {
      if (staticValue && !isPlainObject(staticValue)) {
        value = staticValue;
      } else if (fieldOptions.value && typeof fieldOptions.value === 'function') {
        value = fieldOptions.value(mockObject);
      } else if (fieldOptions.value) {
        ({ value } = fieldOptions);
      } else {
        const type = pathDef.instance.toLowerCase();
        if (!generators[type]) {
          throw new Error(`Type ${pathDef.instance} not supported`);
        }
        const generator = generators[type];
        value = generator(pathDef, fieldOptions, staticValue);
      }
    }
    set(mockObject, path, value);
  }
}

const generate = (schema, options, staticFields) => {
  const mockObject = {};
  schema.eachPath((path) => {
    if (!path.includes('$*')) {
      populateField(mockObject, schema, path, options, get(staticFields, path, undefined));
    }
  });
  return mockObject;
};


class Mocker {
  constructor(model, options = {}) {
    this.model = model;
    this.options = options;
  }

  generate(staticFields = {}) {
    const schema = this.model.schema || this.model;
    return generate(schema, this.options, staticFields);
  }
}

const mocker = (mongooseModel, options) => new Mocker(mongooseModel, options);

module.exports = mocker;