import fs from "fs";
import yaml from "yaml";

const promptFile = fs.readFileSync("./src/prompts.yaml", "utf8");
export const prompts = yaml.parse(promptFile) as Record<string, string>;
