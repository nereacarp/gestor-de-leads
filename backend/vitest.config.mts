import { defineConfig } from "vitest/config";
const URL_TESTS = "postgresql://leads:leads@localhost:5432/leads_test";
export default defineConfig({ test: { env: { DATABASE_URL: URL_TESTS }, fileParallelism: false } });
