import {
  createBleConnectionTransitionTracker,
  shouldNotifyDeviceConnect,
  shouldNotifyDeviceDisconnect,
} from '../utils/bleConnectionNotificationTransitions';

describe('ble connection notification transitions', () => {
  it('does not notify connect when already connected', () => {
    expect(shouldNotifyDeviceConnect(true)).toBe(false);
  });

  it('notifies connect on first connection', () => {
    expect(shouldNotifyDeviceConnect(false)).toBe(true);
  });

  it('does not notify disconnect from initial disconnected state', () => {
    expect(shouldNotifyDeviceDisconnect(false)).toBe(false);
  });

  it('notifies disconnect on connected to disconnected transition', () => {
    expect(shouldNotifyDeviceDisconnect(true)).toBe(true);
  });

  it('does not notify duplicate disconnected to disconnected events', () => {
    const tracker = createBleConnectionTransitionTracker(false);

    tracker.onConnected();
    const first = tracker.onDisconnected('disconnected');
    const second = tracker.onDisconnected('disconnected');

    expect(first.shouldNotifyDisconnect).toBe(true);
    expect(second.shouldNotifyDisconnect).toBe(false);
  });

  it('handles connected to disconnected to disconnected as one notification', () => {
    const tracker = createBleConnectionTransitionTracker(false);

    tracker.onConnected();
    const first = tracker.onDisconnected('disconnected');
    const second = tracker.onDisconnected('link_lost');

    expect(first.shouldNotifyDisconnect).toBe(true);
    expect(second.shouldNotifyDisconnect).toBe(false);
  });

  it('notifies again after reconnect and second disconnect', () => {
    const tracker = createBleConnectionTransitionTracker(false);

    tracker.onConnected();
    tracker.onDisconnected('disconnected');
    tracker.onConnected();
    const secondDisconnect = tracker.onDisconnected('disconnected');

    expect(secondDisconnect.shouldNotifyDisconnect).toBe(true);
  });

  it('preserves disconnect intent before async work clears external state', async () => {
    const tracker = createBleConnectionTransitionTracker(false);

    tracker.onConnected();
    const { shouldNotifyDisconnect } = tracker.onDisconnected('out_of_range');

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(shouldNotifyDisconnect).toBe(true);
    expect(tracker.getWasConnected()).toBe(false);
  });

  it('does not notify connect when remounted while already connected', () => {
    const tracker = createBleConnectionTransitionTracker(true);
    const result = tracker.onConnected();

    expect(result.shouldNotifyConnect).toBe(false);
  });

  it('notifies disconnect when remounted while already connected', () => {
    const tracker = createBleConnectionTransitionTracker(true);
    const result = tracker.onDisconnected('disconnected');

    expect(result.shouldNotifyDisconnect).toBe(true);
  });

  it('does not notify disconnect when master transition state is unknown', () => {
    expect(shouldNotifyDeviceDisconnect(false)).toBe(false);
  });

  it('allows only one notification when manual and passive disconnect events arrive', () => {
    const tracker = createBleConnectionTransitionTracker(false);

    tracker.onConnected();
    const manual = tracker.onDisconnected();
    const passive = tracker.onDisconnected();

    expect(manual.shouldNotifyDisconnect).toBe(true);
    expect(passive.shouldNotifyDisconnect).toBe(false);
  });
});
