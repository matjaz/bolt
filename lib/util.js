/*
 * Copyright 2015 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var Promise = require('promise');

module.exports = {
  'extend': extend,
  'methods': methods,
  'copyArray': copyArray,
  'isType': isType,
  'isThenable': isThenable,
  'maybePromise': maybePromise,
  'ensureExtension': ensureExtension,
  'getProp': maybePromise(function(obj, prop) { return obj[prop]; }),
};

function methods(ctor, obj) {
  extend(ctor.prototype, obj);
}

function extend(dest) {
  var i;
  var source;
  var prop;

  if (dest === undefined) {
    dest = {};
  }
  for (i = 1; i < arguments.length; i++) {
    source = arguments[i];
    for (prop in source) {
      if (source.hasOwnProperty(prop)) {
        dest[prop] = source[prop];
      }
    }
  }

  return dest;
}

function copyArray(arg) {
  return Array.prototype.slice.call(arg);
}

var baseTypes = ['number', 'string', 'boolean', 'array', 'function', 'date',
                 'regexp', 'arguments', 'undefined', 'null'];

function internalType(value) {
  return Object.prototype.toString.call(value).match(/\[object (.*)\]/)[1].toLowerCase();
}

function isType(value, type) {
  return typeOf(value) == type;
}

// Return one of the baseTypes as a string
function typeOf(value) {
  if (value === undefined) {
    return 'undefined';
  }
  if (value === null) {
    return 'null';
  }
  var type = internalType(value);
  if (baseTypes.indexOf(type) == -1) {
    type = typeof(value);
  }
  return type;
}

function isThenable(obj) {
  return typeOf(obj) == 'object' && 'then' in obj && typeof(obj.then) == 'function';
}

// Converts a synchronous function to one allowing Promises
// as arguments and returning a Promise value.
//
//   fn(a, b, c, ...):v => fn(aP, bP, cP, ...): Pv
//
// If none of the arguments are Thenables, then the wrapped
// function returns a synchronous value (not wrapped in a Promise).
function maybePromise(fn) {
  return function() {
    var self = this;
    var args = copyArray(arguments);
    if (!args.some(isThenable)) {
      return fn.apply(self, arguments);
    }

    return Promise.all(args)
      .then(function(values) {
        return fn.apply(self, values);
      });
  };
}

function ensureExtension(fileName, extension) {
  return fileName + '.' + extension;
}
