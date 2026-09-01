export function shouldNotifyDeviceConnect(wasConnected) {
  return !wasConnected;
}

export function shouldNotifyDeviceDisconnect(wasConnected) {
  return Boolean(wasConnected);
}

export function createBleConnectionTransitionTracker(initialConnected = false) {
  let wasConnected = Boolean(initialConnected);

  return {
    getWasConnected() {
      return wasConnected;
    },
    onConnected() {
      const shouldNotify = shouldNotifyDeviceConnect(wasConnected);
      wasConnected = true;
      return { shouldNotifyConnect: shouldNotify };
    },
    onDisconnected() {
      const shouldNotify = shouldNotifyDeviceDisconnect(wasConnected);
      wasConnected = false;
      return { shouldNotifyDisconnect: shouldNotify };
    },
  };
}
