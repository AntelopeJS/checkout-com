const { AsyncResource } = require("node:async_hooks");
const subscriptions = require("@antelopejs/interface-subscriptions");

const PROBE = Symbol.for("antelopejs.checkout-com.renewal-probe");

/**
 * A test calls into the interface from the module under test's context, which
 * does not depend on interface-subscriptions. The calls are bound here, inside
 * this module's own context, and handed to the test through a global.
 */
exports.construct = () => undefined;

exports.start = () => {
  globalThis[PROBE] = {
    CreateSubscription: AsyncResource.bind(subscriptions.CreateSubscription),
    GetSubscription: AsyncResource.bind(subscriptions.GetSubscription),
  };
};

exports.stop = () => {
  delete globalThis[PROBE];
};

exports.destroy = () => undefined;
