// Fallback for unsupported platforms.
module.exports = {
  getNowPlaying: async () => ({ playing: false })
};
