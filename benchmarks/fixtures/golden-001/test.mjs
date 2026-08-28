import assert from "node:assert/strict";
import { greet } from "./src/greeting.js";

assert.equal(greet(), "hello");
