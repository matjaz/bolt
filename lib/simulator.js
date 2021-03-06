/*
 * Firebase Rules test simulator.
 *
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
"use strict";

var Promise = require('promise');
var uuid = require('node-uuid');
var assert = require('chai').assert;
var rest = require('./firebase-rest');
var FirebaseTokenGenerator = require('firebase-token-generator');

// Browserify bug: https://github.com/substack/node-browserify/issues/1150
var bolt = (typeof window != 'undefined' && window.bolt) || require('./bolt');

var util = require('./util');
var fileIO = require('./file-io');

module.exports = {
  rulesSuite: rulesSuite
};

function rulesSuite(suiteName, fnSuite) {
  new RulesSuite(suiteName, fnSuite).run();
}

function RulesSuite(suiteName, fnSuite) {
  this.suiteName = suiteName;
  this.fnSuite = fnSuite;
  this.users = {};
  this.tests = [];
  this.debug = false;
}

util.methods(RulesSuite, {
  setDebug: function(debug) {
    if (debug === undefined) {
      debug = true;
    }
    this.debug = debug;
    return this;
  },

  run: function() {
    var self = this;

    // Run Mocha Test Suite - serialize with any other mocha test suites.
    suite("Firebase Rules Simulator: " + self.suiteName, function() {
      this.timeout(10000);
      suiteSetup(function() {
        var rulesPath = new Promise(function(resolve) {
          self.rulesPathResolve = resolve;
        });

        var database = new Promise(function(resolve) {
          self.databaseReady = resolve;
        });

        var rulesJSON = bolt.generate(util.getProp(fileIO.readFile(rulesPath),
                                                   'content'));

        self.ready = Promise.all([rulesJSON, database])
          .then(self.onRulesReady.bind(self));

        // Execute initialization and get test definitions (in client code).
        self.fnSuite(self.getInterface());

        return self.ready;
      });

      test("Initialization.", function() {
      });

      test("Rules test.", function() {
        return self.runTests();
      });
    });
  },

  // Interface for test functions:
  //   test.rules(rulesPath)
  //   test.database(appName, appSecret)
  //   test(testName, testFunction)
  getInterface: function() {
    var test = this.test.bind(this);
    test.rules = this.rules.bind(this);
    test.database = this.database.bind(this);
    return test;
  },

  // Called when rules are generated and test database is known.
  // Arg: [rulesJSON, true]
  onRulesReady: function(prereq) {
    this.rules = prereq[0];
    return this.adminClient.put(rest.RULES_LOCATION, this.rules);
  },

  runTests: function() {
    var p = Promise.resolve(true);

    function next(prev, test) {
      return prev.then(function() {
        return test.run();
      });
    }

    for (var i = 0; i < this.tests.length; i++) {
      p = next(p, this.tests[i]);
    }

    return p;
  },

  test: function(testName, fnTest) {
    this.tests.push(new RulesTest(testName, this, fnTest));
  },

  rules: function(rulesPath) {
    if (this.rulesPath) {
      throw new Error("Only expect a single call to the test.rules function.");
    }
    this.rulesPath = rulesPath;
    this.rulesPathResolve(util.ensureExtension(rulesPath, bolt.FILE_EXTENSION));
  },

  database: function(appName, appSecret) {
    if (this.adminClient) {
      throw new Error("Only expect a single call to the test.database function.");
    }
    this.appName = appName;
    this.appSecret = appSecret;
    // Why won't this work for writing rules?
    // this.adminClient = this.ensureUser('admin');
    this.adminClient = new rest.Client(appName, appSecret);
    this.anonClient = new rest.Client(appName);
    this.databaseReady();
  },

  ensureUser: function(username) {
    if (username == 'admin') {
      return this.adminClient;
    }
    if (username == 'anon') {
      return this.anonClient;
    }

    if (!(username in this.users)) {
      // TODO: How is this working taking a non-allowed option???
      var token = generateAuthToken({ username: username }, this.appSecret);
      this.users[username] = new rest.Client(this.appName, token);
    }
    return this.users[username];
  },
});

function RulesTest(testName, suite, fnTest) {
  this.testName = testName;
  this.suite = suite;
  this.fnTest = fnTest;
  this.status = undefined;
  this.steps = [];
  this.failed = false;

  // Current user and path (for read/write).
  this.path = undefined;
  this.auth = undefined;
}

util.methods(RulesTest, {
  run: function() {
    this.debug(false);
    this.as('admin');
    this.at('/');
    this.write(null);
    this.succeeds("initialization");

    this.at(undefined);
    this.as('anon');

    this.fnTest(this);

    this.debug(false);

    return this.executeQueue()
      .then(function() {
        this.log("Finished");
      }.bind(this))
      .catch(function(error) {
        this.log("Failed: " + error);
        throw error;
      }.bind(this));
  },

  // Queue a function to be called in sequence after previous step
  // in test is (successfully) completed.
  queue: function(op, args, fn) {
    if (this.failed) {
      return;
    }
    args = util.copyArray(args).map(function(x) {
      return JSON.stringify(x, undefined, 2);
    });
    var label = op + '(' + args.join(', ') + ')';
    this.steps.push({label: label, fn: fn});
  },

  executeQueue: function() {
    var self = this;

    this.log("Executing (" + this.steps.length + " steps)");
    var p = Promise.resolve(true);

    function next(prev, step) {
      return prev.then(function() {
        self.log(step.label);
        return step.fn();
      });
    }

    for (var i = 0; i < this.steps.length; i++) {
      p = next(p, this.steps[i]);
    }

    return p;
  },

  debug: function(debug) {
    this.suite.setDebug(debug);
    this.queue('debug', arguments, function() {
      this.suite.setDebug(debug);
    }.bind(this));
    return this;
  },

  as: function(username) {
    var client = this.suite.ensureUser(username);
    this.queue('as', arguments, function() {
      this.client = client;
    }.bind(this));
    return this;
  },

  at: function(opPath) {
    this.queue('at', arguments, function() {
      this.path = opPath;
    }.bind(this));
    return this;
  },

  write: function(obj) {
    this.queue('write', arguments, function() {
      return this.client.put(this.path, obj)
        .then(function() {
          this.status = true;
        }.bind(this))
        .catch(function(error) {
          this.status = false;
        }.bind(this));
    }.bind(this));
    return this;
  },

  read: function() {
    this.queue('read', arguments, function() {
      return this.client.get(this.path)
        .then(function() {
          this.status = true;
        }.bind(this))
        .catch(function(error) {
          this.status = false;
        }.bind(this));
    }.bind(this));
    return this;
  },

  succeeds: function(message) {
    this.queue('succeeds', arguments, function() {
      assert(this.status === true,
             this.messageFormat(message + " (should have succeed)"));
      this.good(message);
      this.status = undefined;
    }.bind(this));
    return this;
  },

  fails: function(message) {
    this.queue('fails', arguments, function() {
      assert(this.status === false,
             this.messageFormat(message + " (should have failed)"));
      this.good(message);
      this.status = undefined;
    }.bind(this));
    return this;
  },

  good: function(message) {
    this.log(message + " (Correct)");
  },

  log: function(message) {
    if (this.suite.debug) {
      console.log(this.messageFormat(message));
    }
  },

  messageFormat: function(message) {
    return this.suite.suiteName + "." + this.testName + " " + message;
  }
});

function generateAuthToken(opts, secret) {
  opts = util.extend({
    uid: uuid.v4(),
    debug: true,
  }, opts);

  var tokenGenerator = new FirebaseTokenGenerator(secret);
  var token = tokenGenerator.createToken(opts);
  return token;
}
