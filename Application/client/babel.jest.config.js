/**
 * Babel config used only by Jest (see jest.ai.config.js).
 * Kept separate from Metro so Expo bundling is unchanged.
 */
module.exports = {
  plugins: ['@babel/plugin-transform-modules-commonjs'],
};
