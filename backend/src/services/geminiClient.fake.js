function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createFakeGeminiClient(options = {}) {
  const calls = [];
  const delays = options.delays ?? {};

  async function call(method, input, produce) {
    calls.push({ method, input });

    if (delays[method]) {
      await delay(delays[method]);
    }

    const failure = options.failures?.[method];
    if (typeof failure === "function" ? failure(input) : failure) {
      throw new Error(typeof failure === "string" ? failure : `Fake ${method} failure`);
    }

    return produce();
  }

  return {
    calls,
    count(method) {
      return calls.filter((callEntry) => callEntry.method === method).length;
    },
    ensureBookContext(input) {
      return call("ensureBookContext", input, () => ({
        fileUri: options.fileUri ?? "files/fake-book",
        bookInteractionId: options.bookInteractionId ?? "fake-book-interaction"
      }));
    },
    generateStyle(input) {
      return call("generateStyle", input, () => ({
        style: input.style ?? options.style ?? "warm watercolor storybook style",
        gemini: { styleInteractionId: "fake-style-interaction" }
      }));
    },
    generateCharacters(input) {
      return call("generateCharacters", input, () => ({
        characters:
          options.characters ?? [
            { name: "Mole", prompt: "A gentle adult mole in a waistcoat" },
            { name: "Rat", prompt: "A calm adult water rat beside the river" }
          ],
        gemini: { charactersInteractionId: "fake-characters-interaction" }
      }));
    },
    ensureImageContext(input) {
      return call("ensureImageContext", input, () => ({
        charactersImageInteractionId:
          options.charactersImageInteractionId ?? "fake-characters-image-interaction",
        latestImageInteractionId:
          options.charactersImageInteractionId ?? "fake-characters-image-interaction"
      }));
    },
    generatePortrait(input) {
      return call("generatePortrait", input, () => ({
        bytes: Buffer.from(`fake portrait ${input.character.id}`),
        geminiInteractionId: `fake-portrait-${input.character.id}`,
        gemini: { latestImageInteractionId: `fake-portrait-${input.character.id}` }
      }));
    },
    generateChapters(input) {
      return call("generateChapters", input, () => ({
        chapters:
          options.chapters ?? [
            { name: "Riverbank", prompt: "Mole and Rat sharing a quiet riverbank picnic" }
          ],
        gemini: { chaptersInteractionId: "fake-chapters-interaction" }
      }));
    },
    generateIllustration(input) {
      return call("generateIllustration", input, () => ({
        bytes: Buffer.from(`fake illustration ${input.chapter.id}`),
        geminiInteractionId: `fake-illustration-${input.chapter.id}`,
        gemini: { latestImageInteractionId: `fake-illustration-${input.chapter.id}` }
      }));
    }
  };
}
