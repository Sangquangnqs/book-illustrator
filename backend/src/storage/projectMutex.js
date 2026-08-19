export class ProjectMutex {
  #tails = new Map();

  async runExclusive(projectId, callback) {
    const previous = this.#tails.get(projectId) ?? Promise.resolve();

    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate, () => gate);
    this.#tails.set(projectId, tail);

    await previous.catch(() => {});

    try {
      return await callback();
    } finally {
      release();
      if (this.#tails.get(projectId) === tail) {
        this.#tails.delete(projectId);
      }
    }
  }
}
