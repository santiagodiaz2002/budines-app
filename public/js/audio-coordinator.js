export function createAudioCoordinator() {
  const tools = new Map();

  return {
    register(name, stop) {
      if (typeof name !== 'string' || typeof stop !== 'function') {
        throw new TypeError('Audio tool registration is invalid.');
      }
      tools.set(name, stop);
    },

    async requestStart(name) {
      const stops = [];
      for (const [toolName, stop] of tools.entries()) {
        if (toolName !== name) {
          stops.push(Promise.resolve().then(() => stop()));
        }
      }
      await Promise.allSettled(stops);
    }
  };
}
