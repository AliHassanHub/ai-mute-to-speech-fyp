/* eslint-env jest */

// __DEV__ is normally injected by Metro. The AI modules read it for logging.
global.__DEV__ = false;

// Simulation must be off for every test, matching the hardware-only workflow.
process.env.EXPO_PUBLIC_ALLOW_EMG_SIMULATION = 'false';
