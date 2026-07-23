#!/usr/bin/env node

import { enableDevStateDirectory } from "../runtime/dev-state.js";

enableDevStateDirectory();

await import("./queue-worker.js");
