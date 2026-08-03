import { PDFDocument, rgb } from "pdf-lib";
import * as fontkitModule from "fontkit";
import { readFileSync } from "fs";

function getFontkit(): any {
  const ns: any = fontkitModule;
  return typeof ns.create === "function" ? ns : ns.default ?? ns;
}
console.log("fontkit type:", typeof getFontkit().create, "| keys:", Object.keys(getFontkit()).slice(0,5));

const doc = await PDFDocument.create();
doc.registerFontkit(getFontkit());
const font = await doc.embedFont(readFileSync("/Users/batdorjsukhbaatar/llm_agent_dbt/llm_agent_mcp-main/assets/fonts/NotoSans-Regular.ttf"), { subset: true });
const page = doc.addPage([612, 792]);
page.drawText("Сайн уу, Танилц: Санхүүгийн тайлан 2026", { x: 50, y: 700, size: 14, font, color: rgb(0,0,0) });
page.drawText("Hello English + Cyrillic Цахим", { x: 50, y: 680, size: 12, font, color: rgb(0.2,0.2,0.2) });
const bytes = await doc.save();
import { writeFileSync } from "fs";
writeFileSync("/tmp/minimal-font.pdf", bytes);
console.log("saved", bytes.length, "bytes");
