import { defineConfig } from "vitest/config";

// url de la base de datos de los tests (nunca la de desarrollo)
const URL_TESTS = "postgresql://leads:leads@localhost:5432/leads_test";

export default defineConfig({
  test: {
    // los tests usan la base de datos de tests
    env: { DATABASE_URL: URL_TESTS },
    fileParallelism: false, 
  },
});
