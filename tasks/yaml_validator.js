/**
 * grunt-yaml-validator
 * https://github.com/paazmaya/grunt-yaml-validator
 *
 * Copyright (c) Juga Paazmaya <olavic@gmail.com>
 * Licensed under the MIT license.
 */

'use strict';

var yaml = require('js-yaml'),
  check = require('check-type').init(),
  grunt = require('grunt');

var YamlValidatore = function(files, options) {
  this.files = files;
  this.options = options;
  this.logs = [];
  this.mismatchedTypes = []; // list of filepaths
  this.missingKeys = 0;
};


/**
 * Wrapper to call Grunt API and store message for
 * possible later use by writing a log file.
 * @param {string} msg Error message
 */
YamlValidatore.prototype.errored = function errored(msg) {
  this.logs.push(msg);
  grunt.log.error(msg);
};


/**
 * Check that the given object matches the given key structure.
 * @param {Object} doc Object loaded from Yaml file
 * @param {string|Array} keys List of required keys
 * @returns {Array} List of missing keys
 */
YamlValidatore.prototype.checkKeys = function checkKeys(doc, keys) {
  var missing = [];

  if (typeof keys === 'string') {
    keys = [keys];
  }
  keys.forEach(function (key) {
    var has = check(doc).has(key);
    if (!has) {
      missing.push(key);
    }
  });

  return missing;
};

/**
 * Check that the given structure is available.
 * @param {Object} doc Object loaded from Yaml file
 * @param {Object} structure Structure requirements
 * @param {string} parent Address in a dot notation
 * @returns {Array} List of not found structure paths
 */
YamlValidatore.prototype.validateStructure = function validateStructure(doc, structure, parent) {
  var notFound = [],
    current = '',
    validate;

  parent = parent || '';

  for (var key in structure) {
    if (!structure.hasOwnProperty(key)) {
      continue;
    }

    current = parent + (parent.length > 0 ? '.' : '') + key;

    var item = structure[key];

    if (item instanceof Array) {
      if (check(doc[key]).is('Array')) {
        doc[key].forEach(function (child) {
          validate = validateStructure(child, item, current);
          notFound = notFound.concat(validate);
        });
      }
      else {
        notFound.push(false);
      }
    }
    else if (typeof item === 'string') {
      validate = (check(structure).is('Array') || check(doc).has(key)) && check(doc[key]).is(item);
      // Key can be a index number when the structure is an array, but passed as a string
      notFound.push(validate ? false : current);
    }
    else if (typeof item == 'object' && item !== null) {
      validate = validateStructure(doc[key], item, current);
      notFound = notFound.concat(validate);
    }
  }

  return notFound.filter(function (item) {
    return item !== false;
  });
};

/**
 * Check that the requirements are matched.
 * @param {Object} doc Object loaded from Yaml file
 * @param {Object} types Type requirements
 * @returns {boolean} Doc has the types defined
 */
YamlValidatore.prototype.checkTypes = function checkTypes(doc, types) {
  var checked = check(doc).matches(types);
  return checked;
};

/**
 * Read the given Yaml file, load and check its structure.
 * @param {string} filepath Yaml file path
 * @returns {number} 0 when no errors, 1 when errors.
 */
YamlValidatore.prototype.checkFile = function checkFile(filepath) {

  // Verbose output will tell which file is being read
  var data = grunt.file.read(filepath),
    hadError = 0,
    _self = this;

  var doc = yaml.safeLoad(data, {
    onWarning: function (error) {
      hadError = 1;
      _self.errored(error);
      if (_self.options.yaml &&
        typeof _self.options.yaml.onWarning === 'function') {
        _self.options.yaml.onWarning.call(this, error, filepath);
      }
    }
  });

  if (this.options.writeJson) {
    var json = JSON.stringify(doc, null, '  ');
    grunt.file.write(filepath.replace(/yml$/, 'json'), json);
  }

  if (this.options.structure) {
    var validStructure = this.validateStructure(doc, this.options.structure);

    if (validStructure.length > 0) {
      hadError = 1;
      this.errored(filepath + ' is not following the correct structure, missing:');
      this.errored(grunt.log.wordlist(validStructure, {color: 'grey'}));
    }
  }

  if (this.options.keys) {
    var missing = this.checkKeys(doc, this.options.keys);
    var len = missing.length;

    if (len > 0) {
      hadError = 1;
      this.errored(filepath + ' is missing the following keys: ');
      this.errored(grunt.log.wordlist(missing, {color: 'grey'}));
    }

    // Increment the number of keys that were not according to the requirement
    this.missingKeys += len;
  }

  if (this.options.types) {
    var mismatching = this.checkTypes(doc, this.options.types);
    if (!mismatching) {
      hadError = 1;
      this.errored(filepath + ' is not matching the type requirements');
      this.mismatchedTypes.push(filepath);
    }
  }

  return hadError;
};

/**
 * Create a report out of this, but in reality also run.
 */
YamlValidatore.prototype.validate = function validate() {
  var _self = this;
  this.haveErrors = this.files.map(function (filepath) {
    return _self.checkFile(filepath);
  }).reduce(function (prev, curr) {
    return prev + curr;
  });

};

/**
 * Create a report out of this, but in reality also run.
 */
YamlValidatore.prototype.report = function report() {
  var msg;

  if (this.mismatchedTypes.length > 0) {
    this.errored('Type mismatching found in total of ' + this.mismatchedTypes.length + ' files');
  }
  else {
    msg = 'No mismatching type requirements found.';
    this.logs.push(msg);
    grunt.verbose.writeln(msg);
  }

  if (this.missingKeys === 0) {
    msg = 'All done. No missing keys found. Thank you.';
    this.logs.push(msg);
    grunt.verbose.writeln(msg);
  }
  else {
    this.errored('Found missing keys, total of: ' + this.missingKeys);
  }

  grunt.verbose.writeln('Out of ' + this.files.length + ' files, ' + this.haveErrors + ' have validation errors');


  if (typeof this.options.log === 'string') {
    grunt.file.write(this.options.log, grunt.log.uncolor(this.logs.join('\n')));
  }
};

module.exports = function yamlValidator(grunt) {

  grunt.registerMultiTask('yaml_validator', 'Validate Yaml files and enforce a given structure', function() {

    // Default options
    var options = this.options({
      log: false,
      keys: false,
      types: false,
      structure: false,
      yaml: false,
      writeJson: false
    });

    var files = this.filesSrc.filter(function(filepath) {
      if (!grunt.file.exists(filepath)) {
        grunt.log.warn('Source file "' + filepath + '" not found.');
        return false;
      }
      return true;
    });

    var validator = new YamlValidatore(files, options);
    validator.validate();
    validator.report();

  });

};
