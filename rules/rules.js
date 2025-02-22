/**
 * Rules namespace.
 * This namespace allows creation of openHAB rules.
 *
 * @namespace rules
 */

// typedefs need to be global for TypeScript to fully work
/**
 * @typedef {object} EventObject When a rule is triggered, the script is provided the event instance that triggered it. The specific data depends on the event type. The `EventObject` provides several information about that trigger.
 *
 * Note:
 * `Group****Trigger`s use the equivalent `Item****Trigger` as trigger for each member.
 * Time triggers do not provide any event instance, therefore no property is populated.
 *
 * @property {string} oldState only for {@link triggers.ItemStateChangeTrigger} & {@link triggers.GroupStateChangeTrigger}: Previous state of Item or Group that triggered event
 * @property {string} newState only for {@link triggers.ItemStateChangeTrigger} & {@link triggers.GroupStateChangeTrigger}: New state of Item or Group that triggered event
 * @property {string} receivedState only for {@link triggers.ItemStateUpdateTrigger} & {@link triggers.GroupStateUpdateTrigger}: State that triggered event
 * @property {string} receivedCommand only for {@link triggers.ItemCommandTrigger}, {@link triggers.GroupCommandTrigger}, {@link triggers.PWMTrigger} & {@link triggers.PIDTrigger} : Command that triggered event
 * @property {string} itemName for all triggers except {@link triggers.PWMTrigger}: name of Item that triggered event
 * @property {string} receivedEvent only for {@link triggers.ChannelEventTrigger}: Channel event that triggered event
 * @property {string} channelUID only for {@link triggers.ChannelEventTrigger}: UID of channel that triggered event
 * @property {string} oldStatus only for {@link triggers.ThingStatusChangeTrigger}: Previous state of Thing that triggered event
 * @property {string} newStatus only for {@link triggers.ThingStatusChangeTrigger}: New state of Thing that triggered event
 * @property {string} status only for {@link triggers.ThingStatusUpdateTrigger}: State of Thing that triggered event
 * @property {string} eventType for all triggers except {@link triggers.PWMTrigger}, {@link triggers.PIDTrigger}, time triggers: Type of event that triggered event (change, command, time, triggered, update)
 * @property {string} triggerType for all triggers except {@link triggers.PWMTrigger}, {@link triggers.PIDTrigger}, time triggers: Type of trigger that triggered event (for `TimeOfDayTrigger`: `GenericCronTrigger`)
 * @property {*} payload for most triggers
 */

/**
 * @callback RuleCallback When a rule is run, a callback is executed.
 * @param {EventObject} event
 */

/**
 * @typedef {object} RuleConfig configuration for {@link rules.JSRule}
 * @property {string} name name of the rule (used in UI)
 * @property {string} [description] description of the rule (used in UI)
 * @property {HostTrigger|HostTrigger[]} triggers which will fire the rule
 * @property {RuleCallback} execute callback to run when the rule fires
 * @property {string} [id] UID of the rule, if not provided, one is generated
 * @property {string[]} [tags] tags for the rule (used in UI)
 * @property {string} [ruleGroup] name of rule group to use
 * @property {boolean} [overwrite=false] whether to overwrite an existing rule with the same UID
 */

const GENERATED_RULE_ITEM_TAG = 'GENERATED_RULE_ITEM';

const items = require('../items');
const utils = require('../utils');
const log = require('../log')('rules');
const osgi = require('../osgi');
const triggers = require('../triggers');
const { automationManager, ruleRegistry } = require('@runtime/RuleSupport');

const RuleManager = osgi.getService('org.openhab.core.automation.RuleManager');

/**
  * Generates an Item name given the rule configuration.
  *
  * @private
  * @param {object} ruleConfig The rule config
  */
const _itemNameForRule = (ruleConfig) => 'vRuleItemFor' + items.safeItemName(ruleConfig.name);

/**
  * Links an Item to a rule. When the Item is switched on or off, so will the rule be.
  *
  * @private
  * @param {HostRule} rule The rule to link to the Item.
  * @param {items.Item} item the Item to link to the rule.
  */
function _linkItemToRule (rule, item) {
  JSRule({
    name: 'vProxyRuleFor' + rule.getName(),
    description: 'Generated Rule to toggle real rule for ' + rule.getName(),
    triggers: [
      triggers.ItemStateUpdateTrigger(item.name)
    ],
    execute: function (data) {
      try {
        const itemState = data.receivedState;
        log.debug('Rule toggle Item state received as ' + itemState);
        RuleManager.setEnabled(rule.getUID(), itemState !== 'OFF');
        log.info((itemState === 'OFF' ? 'Disabled' : 'Enabled') + ' rule ' + rule.getName() + ' [' + rule.getUID() + ']');
      } catch (e) {
        log.error('Failed to toggle rule ' + rule.getName() + ': ' + e);
      }
    }
  });
}

/**
  * Gets the groups that a rule-toggling Item should be a member of. Will create the group Item if necessary.
  *
  * @private
  * @param {RuleConfig} ruleConfig The rule config describing the rule
  * @returns {string} the group name to put the Item in
  */
function _getGroupForItem (ruleConfig) {
  if (ruleConfig.ruleGroup) {
    const groupName = 'gRules' + items.safeItemName(ruleConfig.ruleGroup);
    log.debug('Creating rule group ' + ruleConfig.ruleGroup);
    items.replaceItem({
      name: groupName,
      type: 'Group',
      groups: ['gRules'],
      label: ruleConfig.ruleGroup,
      tags: [GENERATED_RULE_ITEM_TAG]
    });
    return groupName;
  }

  return 'gRules';
}

/**
  * Check whether a rule exists.
  * Only works for rules created in the same file.
  *
  * @private
  * @param {string} uid the UID of the rule
  * @returns {boolean} whether the rule exists
  */
function _ruleExists (uid) {
  return !(RuleManager.getStatusInfo(uid) == null);
}

/**
  * Remove a rule when it exists. The rule will be immediately removed.
  * Only works for rules created in the same file.
  *
  * @memberof rules
  * @param {string} uid the UID of the rule
  * @returns {boolean} whether the rule was actually removed
  */
function removeRule (uid) {
  if (_ruleExists(uid)) {
    log.info('Removing rule: {}', ruleRegistry.get(uid).name ? ruleRegistry.get(uid).name : uid);
    ruleRegistry.remove(uid);
    return !_ruleExists(uid);
  } else {
    return false;
  }
}

/**
  * Runs the rule with the given UID. Throws errors when the rule doesn't exist
  * or is unable to run (e.g. it's disabled).
  *
  * @memberof rules
  * @param {string} uid the UID of the rule to run
  * @param {object} [args={}] args optional dict of data to pass to the called rule
  * @param {boolean} [cond=true] when true, the called rule will only run if it's conditions are met
  * @throws Will throw an error if the rule does not exist or is not initialized.
  */
function runRule (uid, args = {}, cond = true) {
  const status = RuleManager.getStatus(uid);
  if (!status) {
    throw Error('There is no rule with UID ' + uid);
  }
  if (status.toString() === 'UNINITIALIZED') {
    throw Error('Rule ' + uid + ' is UNINITIALIZED');
  }

  RuleManager.runNow(uid, cond, args);
}

/**
  * Tests to see if the rule with the given UID is enabled or disabled. Throws
  * and error if the rule doesn't exist.
  *
  * @memberof rules
  * @param {string} uid
  * @returns {boolean} whether or not the rule is enabled
  * @throws {Error} an error when the rule is not found.
  */
function isEnabled (uid) {
  if (!_ruleExists(uid)) {
    throw Error('There is no rule with UID ' + uid);
  }
  return RuleManager.isEnabled(uid);
}

/**
  * Enables or disables the rule with the given UID. Throws an error if the rule doesn't exist.
  *
  * @memberof rules
  * @param {string} uid UID of the rule
  * @param {boolean} isEnabled when true, the rule is enabled, otherwise the rule is disabled
  * @throws {Error} an error when the rule is not found.
  */
function setEnabled (uid, isEnabled) {
  if (!_ruleExists(uid)) {
    throw Error('There is no rule with UID ' + uid);
  }
  RuleManager.setEnabled(uid, isEnabled);
}

/**
  * Creates a rule. The rule will be created and immediately available.
  *
  * @example
  * import { rules, triggers } = require('openhab');
  *
  * rules.JSRule({
  *  name: "my_new_rule",
  *  description: "this rule swizzles the swallows",
  *  triggers: triggers.GenericCronTrigger("0 30 16 * * ? *"),
  *  execute: (event) => { // do stuff }
  * });
  *
  * @memberof rules
  * @param {RuleConfig} ruleConfig The rule config describing the rule
  * @returns {HostRule} the created rule
  * @throws {Error} an error if the rule with the passed in uid already exists and {@link RuleConfig.overwrite} is not `true`
  */
function JSRule (ruleConfig) {
  const ruleUID = ruleConfig.id || ruleConfig.name.replace(/[^\w]/g, '-') + '-' + utils.randomUUID();
  if (ruleConfig.overwrite === true) {
    removeRule(ruleUID);
  }
  if (_ruleExists(ruleUID)) {
    throw Error(`Failed to add rule: ${ruleConfig.name ? ruleConfig.name : ruleUID}, a rule with same UID [${ruleUID}] already exists!`);
  }
  log.info('Adding rule: {}', ruleConfig.name ? ruleConfig.name : ruleUID);

  const SimpleRule = Java.extend(Java.type('org.openhab.core.automation.module.script.rulesupport.shared.simple.SimpleRule'));

  function doExecute (module, input) {
    try {
      return ruleConfig.execute(_getTriggeredData(input));
    } catch (error) {
      // logging error is required for meaningful error log message
      // when throwing error: error is caught by core framework and no meaningful message is logged
      let msg;
      if (error.stack) {
        msg = `Failed to execute rule ${ruleUID}: ${error}: ${error.stack}`;
      } else {
        msg = `Failed to execute rule ${ruleUID}: ${error}`;
      }
      console.error(msg);
      throw Error(msg);
    }
  }

  let rule = new SimpleRule({
    execute: doExecute,
    getUID: () => ruleUID
  });

  rule.setTemplateUID(ruleUID); // Not sure if we need this at all

  if (ruleConfig.description) {
    rule.setDescription(ruleConfig.description);
  }
  if (ruleConfig.name) {
    rule.setName(ruleConfig.name);
  }
  if (ruleConfig.tags) {
    rule.setTags(utils.jsArrayToJavaSet(ruleConfig.tags));
  }

  // Register rule here
  if (ruleConfig.triggers) {
    if (!Array.isArray(ruleConfig.triggers)) ruleConfig.triggers = [ruleConfig.triggers];
    rule.setTriggers(ruleConfig.triggers);
    rule = automationManager.addRule(rule);
  } else {
    throw new Error(`Triggers are missing for rule "${ruleConfig.name ? ruleConfig.name : ruleUID}"!`);
  }

  // Add config to the action so that MainUI can show the script
  const actionConfiguration = rule.actions.get(0).getConfiguration();
  actionConfiguration.put('type', 'application/javascript;version=ECMAScript-2021'); // TODO: Update MIME type at some time
  actionConfiguration.put('script', '// Code to run when the rule fires:\n// Note that Rule Builder is currently not supported!\n\n' + ruleConfig.execute.toString());

  return rule;
}

/**
  * Creates a rule, with an associated SwitchItem that can be used to toggle the rule's enabled state.
  * The rule will be created and immediately available.
  *
  * @memberof rules
  * @param {RuleConfig} ruleConfig The rule config describing the rule
  * @returns {HostRule} the created rule
  * @throws {Error} an error is a rule with the given UID already exists.
  */
function SwitchableJSRule (ruleConfig) {
  if (!ruleConfig.name) {
    throw Error('No name specified for rule!');
  }

  // First create a toggling Item
  const itemName = _itemNameForRule(ruleConfig);
  const item = items.replaceItem({
    name: itemName,
    type: 'Switch',
    groups: [_getGroupForItem(ruleConfig)],
    label: ruleConfig.description,
    tags: [GENERATED_RULE_ITEM_TAG]
  });

  // create the real rule
  const rule = JSRule(ruleConfig);

  // hook up a rule to link the item to the actual rule
  _linkItemToRule(rule, item);

  if (item.isUninitialized) {
    // possibly load item's prior state
    let historicState = null;
    try {
      historicState = item.history.latestState();
    } catch (e) {
      log.warn(`Failed to get historic state of ${itemName} for rule ${ruleConfig.name}: ${e}`);
    }

    if (historicState !== null) {
      item.postUpdate(historicState);
    } else {
      item.sendCommand('ON');
    }
  }
}

/**
 * Adds a key's value from a Java HashMap to a JavaScript object (as string) if the HashMap has that key.
 * This function uses the mutable nature of JS objects and does not return anything.
 *
 * @private
 * @param {*} hashMap Java HashMap
 * @param {string} key key from the HashMap to add to the JS object
 * @param {object} object JavaScript object
 */
function _addFromHashMap (hashMap, key, object) {
  if (hashMap.containsKey(key)) object[key] = hashMap[key].toString();
}

/**
 * Get rule trigger data from raw Java input and generate JavaScript object.
 *
 * @private
 * @param {*} input raw Java input from openHAB core
 * @returns {rules.EventObject}
 */
function _getTriggeredData (input) {
  const event = input.get('event');
  const data = {};

  // Properties of data are dynamically added, depending on their availability

  // Item triggers
  if (input.containsKey('command')) data.receivedCommand = input.get('command').toString();
  _addFromHashMap(input, 'oldState', data);
  _addFromHashMap(input, 'newState', data);
  if (input.containsKey('state')) data.receivedState = input.get('state').toString();

  // Thing triggers
  _addFromHashMap(input, 'oldStatus', data);
  _addFromHashMap(input, 'newStatus', data);
  _addFromHashMap(input, 'status', data);

  // Only with event data (for Item, Thing & Channel triggers)
  if (event) {
    switch (Java.typeName(event.getClass())) {
      case 'org.openhab.core.items.events.GroupItemCommandEvent':
      case 'org.openhab.core.items.events.ItemCommandEvent':
        data.itemName = event.getItemName();
        data.eventType = 'command';
        data.triggerType = 'ItemCommandTrigger';
        break;
      case 'org.openhab.core.items.events.GroupItemStateChangedEvent':
      case 'org.openhab.core.items.events.ItemStateChangedEvent':
        data.itemName = event.getItemName();
        data.eventType = 'change';
        data.triggerType = 'ItemStateChangeTrigger';
        break;
      // **StateEvents replaced by **StateUpdatedEvents in https://github.com/openhab/openhab-core/pull/3141
      case 'org.openhab.core.items.events.ItemStateUpdatedEvent':
      case 'org.openhab.core.items.events.GroupStateUpdatedEvent':
      case 'org.openhab.core.items.events.GroupItemStateEvent':
      case 'org.openhab.core.items.events.ItemStateEvent':
        data.itemName = event.getItemName();
        data.eventType = 'update';
        data.triggerType = 'ItemStateUpdateTrigger';
        Object.defineProperty(
          data,
          'state',
          {
            get: function () {
              console.warn('"state" has been deprecated and will be removed in a future release. Please use "receivedState" instead.');
              return input.get('state').toString();
            }
          }
        );
        break;
      case 'org.openhab.core.thing.events.ThingStatusInfoChangedEvent':
        data.thingUID = event.getThingUID().toString();
        data.eventType = 'change';
        data.triggerType = 'ThingStatusChangeTrigger';
        break;
      case 'org.openhab.core.thing.events.ThingStatusInfoEvent':
        data.thingUID = event.getThingUID().toString();
        data.eventType = 'update';
        data.triggerType = 'ThingStatusUpdateTrigger';
        break;
      case 'org.openhab.core.thing.events.ChannelTriggeredEvent':
        data.channelUID = event.getChannel().toString();
        data.receivedEvent = event.getEvent();
        data.eventType = 'triggered';
        data.triggerType = 'ChannelEventTrigger';
        Object.defineProperty(
          data,
          'receivedTrigger',
          {
            get: function () {
              console.warn('"receivedTrigger" has been deprecated and will be removed in a future release. Please use "receivedEvent" instead.');
              return event.getEvent();
            }
          }
        );
        break;
    }
    data.eventClass = Java.typeName(event.getClass());
    try {
      if (event.getPayload()) {
        data.payload = JSON.parse(event.getPayload());
        log.debug('Extracted event payload {}', data.payload);
      }
    } catch (e) {
      log.warn('Failed to extract payload: {}', e.message);
    }
  }

  // Always
  _addFromHashMap(input, 'module', data);

  // If the ScriptEngine gets an empty input, the trigger is either time based or the rule is run manually!!
  if (input.size() === 0) {
    data.eventType = '';
    data.triggerType = '';
  }

  return data;
}

module.exports = {
  removeRule,
  runRule,
  isEnabled,
  setEnabled,
  JSRule,
  SwitchableJSRule
};
