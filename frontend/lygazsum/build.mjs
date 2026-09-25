import { mkdir, writeFile } from "node:fs/promises";

const outputDirectory = "dist";
await mkdir(outputDirectory, { recursive: true });
await writeFile(`${outputDirectory}/index.html`, "<!doctype html><title>Lyzer</title>\n");
