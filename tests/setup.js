// tests/setup.js
// Global setup run before every test file.

import { installStorageMocks } from './storageMock'

// Install storage mocks globally so all tests start with a clean browser-like environment
installStorageMocks()
