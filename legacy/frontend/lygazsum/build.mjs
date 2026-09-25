// 建立 Vercel 舊站轉址部署所需的最小靜態輸出
import { mkdir, writeFile } from "node:fs/promises";

const outputDirectory = "dist";
await mkdir(outputDirectory, { recursive: true });
await writeFile(`${outputDirectory}/index.html`, "<!doctype html><title>Lyzer</title>\n");
