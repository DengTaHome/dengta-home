import { countPersonalizationCharacters } from "./personalization-editor.js";

self.onmessage = (event) => {
  self.postMessage({ count: countPersonalizationCharacters(event.data) });
};
