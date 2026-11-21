// services/StorageService.js
export class StorageService {
  async load(key) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error(`Storage load error for ${key}:`, error);
      throw error;
    }
  }

  async save(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
      console.error(`Storage save error for ${key}:`, error);
      throw error;
    }
  }

  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`Storage remove error for ${key}:`, error);
      throw error;
    }
  }

  clear() {
    try {
      localStorage.clear();
    } catch (error) {
      console.error("Storage clear error:", error);
      throw error;
    }
  }
}
