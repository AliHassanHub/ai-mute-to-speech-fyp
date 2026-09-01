/**
 * Live POT monitor — verifies the shared BLE stream fans out without duplicate subscriptions.
 */

const mockRemove = jest.fn();
const mockMonitor = jest.fn(() => ({ remove: mockRemove }));

jest.mock('../services/bleService', () => ({
  getConnectedBleDevice: jest.fn(),
}));

const { getConnectedBleDevice } = require('../services/bleService');
const service = require('../services/emgStreamService');

function mockConnectedDevice() {
  getConnectedBleDevice.mockReturnValue({
    id: 'AA:BB:CC',
    monitorCharacteristicForService: mockMonitor,
  });
}

describe('emgStreamService live POT monitor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getConnectedBleDevice.mockReturnValue(null);
    service.clearLiveEmgState();
  });

  it('starts a single hardware subscription for live monitor', async () => {
    mockConnectedDevice();
    const onLive = jest.fn();

    const first = await service.ensureLiveMonitor(onLive);
    expect(first.mode).toBe('hardware');
    expect(mockMonitor).toHaveBeenCalledTimes(1);

    const second = await service.ensureLiveMonitor(onLive);
    expect(second.mode).toBe('hardware');
    expect(mockMonitor).toHaveBeenCalledTimes(1);
  });

  it('reuses the same subscription when recording starts after monitor', async () => {
    mockConnectedDevice();
    await service.ensureLiveMonitor(jest.fn());

    const onRecord = jest.fn();
    await service.startEmgStream({ onSample: onRecord });

    expect(mockMonitor).toHaveBeenCalledTimes(1);
    expect(service.isStreamActive()).toBe(true);
  });

  it('keeps the hardware subscription when recording stops with keepMonitor', async () => {
    mockConnectedDevice();
    await service.ensureLiveMonitor(jest.fn());
    await service.startEmgStream({ onSample: jest.fn() });

    const removeCallsBefore = mockRemove.mock.calls.length;
    service.stopEmgStream({ keepMonitor: true });

    expect(mockRemove.mock.calls.length).toBe(removeCallsBefore);
    expect(service.isStreamActive()).toBe(true);
  });

  it('clears live sample state on clearLiveEmgState', async () => {
    mockConnectedDevice();
    await service.ensureLiveMonitor(jest.fn());
    service.clearLiveEmgState();

    expect(mockRemove).toHaveBeenCalled();
    expect(service.getLastLiveSample()).toBeNull();
    expect(service.isStreamActive()).toBe(false);
  });
});
