import assert from "node:assert/strict";
import { slug } from "./src/slug.js";

assert.equal(slug("  Hello Local Agent  "), "hello-local-agent");
