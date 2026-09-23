import {setTimeout} from "node:timers/promises"; console.log(process.argv[2], "start", Date.now()); await setTimeout(1000); console.log(process.argv[2], "end", Date.now());
