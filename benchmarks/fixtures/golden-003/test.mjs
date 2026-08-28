import assert from "node:assert/strict";
import { clamp } from "./src/clamp.js";

assert.equal(clamp(12, 0, 10), 10);
assert.equal(clamp(-2, 0, 10), 0);
