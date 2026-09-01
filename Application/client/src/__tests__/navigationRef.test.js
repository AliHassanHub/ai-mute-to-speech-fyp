/**
 * Root navigation helpers for auth transitions.
 */

const mockDispatch = jest.fn();
const mockIsReady = jest.fn(() => true);

jest.mock('@react-navigation/native', () => ({
  createNavigationContainerRef: jest.fn(() => ({
    isReady: mockIsReady,
    dispatch: mockDispatch,
    reset: jest.fn(),
  })),
  CommonActions: {
    reset: jest.fn((payload) => ({ type: 'RESET', payload })),
  },
}));

describe('navigationRef auth resets', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    mockDispatch.mockClear();
    mockIsReady.mockReset();
    mockIsReady.mockReturnValue(true);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resetToLogin targets the unauthenticated Auth stack', () => {
    const { resetToLogin } = require('../navigation/navigationRef');
    const { CommonActions } = require('@react-navigation/native');

    resetToLogin();

    expect(CommonActions.reset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: 'Auth', state: { routes: [{ name: 'Login' }] } }],
    });
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'RESET',
      payload: {
        index: 0,
        routes: [{ name: 'Auth', state: { routes: [{ name: 'Login' }] } }],
      },
    });
  });

  it('waits for the navigation container before dispatching resetToLogin', () => {
    mockIsReady.mockReturnValue(false);

    const { resetToLogin } = require('../navigation/navigationRef');

    resetToLogin();
    expect(mockDispatch).not.toHaveBeenCalled();

    mockIsReady.mockReturnValue(true);
    jest.runAllTimers();

    expect(mockDispatch).toHaveBeenCalled();
  });
});
