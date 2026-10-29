import {defineConfig} from 'vitest/config'; export default defineConfig({test:{include:['apps/recovery/src/**/*.test.ts'],environment:'node'}});
