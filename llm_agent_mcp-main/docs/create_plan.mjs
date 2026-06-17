import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, BorderStyle, ShadingType,
  LevelFormat, PageNumber, Footer, Header, PageBreak,
  VerticalAlign, TableOfContents
} from 'docx';
import fs from 'fs';

const FONT = "Arial";
const COLOR_ACCENT = "1A56A0";
const COLOR_LIGHT = "E8F0FB";
const COLOR_MID = "BDD0F0";
const COLOR_DARK = "0D3B7A";
const COLOR_GREEN = "1E7A3E";
const COLOR_GREEN_LIGHT = "E6F4EC";
const COLOR_ORANGE = "C25E00";
const COLOR_ORANGE_LIGHT = "FEF3E6";
const COLOR_RED = "A01A1A";
const COLOR_RED_LIGHT = "FDEAEA";
const COLOR_GRAY = "555555";
const COLOR_GRAY_LIGHT = "F5F5F5";

const border = (color = "CCCCCC") => ({ style: BorderStyle.SINGLE, size: 4, color });
const borders = (color = "CCCCCC") => ({ top: border(color), bottom: border(color), left: border(color), right: border(color) });
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

function h1(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 36, color: COLOR_DARK, font: FONT })],
    spacing: { before: 400, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: COLOR_ACCENT, space: 4 } }
  });
}

function h2(text, color = COLOR_ACCENT) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 28, color, font: FONT })],
    spacing: { before: 320, after: 120 }
  });
}

function h3(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 24, color: COLOR_GRAY, font: FONT })],
    spacing: { before: 200, after: 80 }
  });
}

function para(text, options = {}) {
  return new Paragraph({
    children: [new TextRun({ text, size: 22, font: FONT, color: "222222", ...options })],
    spacing: { before: 60, after: 60 }
  });
}

function bullet(text, bold_prefix = null) {
  const children = [];
  if (bold_prefix) {
    children.push(new TextRun({ text: bold_prefix + " ", bold: true, size: 22, font: FONT, color: "222222" }));
    children.push(new TextRun({ text, size: 22, font: FONT, color: "444444" }));
  } else {
    children.push(new TextRun({ text, size: 22, font: FONT, color: "444444" }));
  }
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    children,
    spacing: { before: 40, after: 40 }
  });
}

function spacer(before = 120) {
  return new Paragraph({ children: [new TextRun({ text: "" })], spacing: { before, after: 0 } });
}

// Phase card table
function phaseCard(phaseNum, phaseName, duration, color, lightColor, tasks, deliverables, milestone) {
  const headerCell = new TableCell({
    width: { size: 1400, type: WidthType.DXA },
    shading: { fill: color, type: ShadingType.CLEAR },
    borders: borders(color),
    margins: { top: 160, bottom: 160, left: 160, right: 160 },
    verticalAlign: VerticalAlign.CENTER,
    rowSpan: 1,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: `Фаз ${phaseNum}`, bold: true, size: 20, color: "FFFFFF", font: FONT }),
          new TextRun({ text: "\n", break: 1 }),
          new TextRun({ text: phaseName, bold: true, size: 18, color: "FFFFFF", font: FONT }),
          new TextRun({ text: "\n", break: 1 }),
          new TextRun({ text: duration, size: 16, color: "EEEEEE", font: FONT }),
        ]
      })
    ]
  });

  const tasksText = tasks.map(t => `• ${t}`).join("\n");
  const tasksCell = new TableCell({
    width: { size: 4400, type: WidthType.DXA },
    shading: { fill: lightColor, type: ShadingType.CLEAR },
    borders: borders("DDDDDD"),
    margins: { top: 120, bottom: 120, left: 160, right: 160 },
    children: [
      new Paragraph({
        children: [new TextRun({ text: "Үндсэн ажлууд", bold: true, size: 20, font: FONT, color: color })],
        spacing: { before: 0, after: 60 }
      }),
      ...tasks.map(t => new Paragraph({
        children: [new TextRun({ text: `• ${t}`, size: 20, font: FONT, color: "333333" })],
        spacing: { before: 30, after: 30 }
      }))
    ]
  });

  const delivCell = new TableCell({
    width: { size: 3560, type: WidthType.DXA },
    borders: borders("DDDDDD"),
    margins: { top: 120, bottom: 120, left: 160, right: 160 },
    children: [
      new Paragraph({
        children: [new TextRun({ text: "Гаралт / Milestone", bold: true, size: 20, font: FONT, color: COLOR_DARK })],
        spacing: { before: 0, after: 60 }
      }),
      ...deliverables.map(d => new Paragraph({
        children: [new TextRun({ text: `✓ ${d}`, size: 20, font: FONT, color: "333333" })],
        spacing: { before: 30, after: 30 }
      })),
      new Paragraph({
        children: [
          new TextRun({ text: "🏁 ", size: 20, font: FONT }),
          new TextRun({ text: milestone, bold: true, size: 20, font: FONT, color: color })
        ],
        spacing: { before: 80, after: 0 }
      })
    ]
  });

  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [1400, 4400, 3560],
    rows: [new TableRow({ children: [headerCell, tasksCell, delivCell] })]
  });
}

// Simple info table 2-col
function infoTable(rows, colWidths = [3000, 6360]) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: rows.map(([label, value, isHeader]) => new TableRow({
      children: [
        new TableCell({
          width: { size: colWidths[0], type: WidthType.DXA },
          shading: { fill: isHeader ? COLOR_ACCENT : COLOR_LIGHT, type: ShadingType.CLEAR },
          borders: borders(COLOR_MID),
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({
            children: [new TextRun({ text: label, bold: true, size: 20, font: FONT, color: isHeader ? "FFFFFF" : COLOR_DARK })]
          })]
        }),
        new TableCell({
          width: { size: colWidths[1], type: WidthType.DXA },
          borders: borders(COLOR_MID),
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({
            children: [new TextRun({ text: value, size: 20, font: FONT, color: isHeader ? "FFFFFF" : "333333", bold: isHeader })]
          })]
        })
      ]
    }))
  });
}

// Risk table
function riskTable(risks) {
  const headerRow = new TableRow({
    children: [
      ["Эрсдэл", 2800],
      ["Нөлөөлөл", 1400],
      ["Магадлал", 1400],
      ["Арга хэмжээ", 3760]
    ].map(([label, w]) => new TableCell({
      width: { size: w, type: WidthType.DXA },
      shading: { fill: COLOR_DARK, type: ShadingType.CLEAR },
      borders: borders(COLOR_DARK),
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20, font: FONT, color: "FFFFFF" })] })]
    }))
  });

  const dataRows = risks.map(([risk, impact, prob, action, levelColor]) => new TableRow({
    children: [
      [risk, 2800, "FFFFFF"],
      [impact, 1400, levelColor || "FFFFFF"],
      [prob, 1400, levelColor || "FFFFFF"],
      [action, 3760, "FFFFFF"]
    ].map(([text, w, fill]) => new TableCell({
      width: { size: w, type: WidthType.DXA },
      shading: { fill, type: ShadingType.CLEAR },
      borders: borders("CCCCCC"),
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text, size: 20, font: FONT, color: "333333" })] })]
    }))
  }));

  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2800, 1400, 1400, 3760],
    rows: [headerRow, ...dataRows]
  });
}

// Stack table
function stackTable(rows) {
  const headerRow = new TableRow({
    children: [
      ["Бүрэлдэхүүн", 2200],
      ["PoC (Фаз 1)", 1800],
      ["Пилот (Фаз 2)", 1800],
      ["Масштаб (Фаз 3-4)", 2200],
      ["Тайлбар", 1360]
    ].map(([label, w]) => new TableCell({
      width: { size: w, type: WidthType.DXA },
      shading: { fill: COLOR_ACCENT, type: ShadingType.CLEAR },
      borders: borders(COLOR_ACCENT),
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 18, font: FONT, color: "FFFFFF" })] })]
    }))
  });

  const dataRows = rows.map(([comp, poc, pilot, scale, note], i) => new TableRow({
    children: [
      [comp, 2200, i % 2 === 0 ? COLOR_GRAY_LIGHT : "FFFFFF", true],
      [poc, 1800, i % 2 === 0 ? COLOR_GRAY_LIGHT : "FFFFFF", false],
      [pilot, 1800, i % 2 === 0 ? COLOR_GRAY_LIGHT : "FFFFFF", false],
      [scale, 2200, i % 2 === 0 ? COLOR_GRAY_LIGHT : "FFFFFF", false],
      [note, 1360, i % 2 === 0 ? COLOR_GRAY_LIGHT : "FFFFFF", false],
    ].map(([text, w, fill, bold]) => new TableCell({
      width: { size: w, type: WidthType.DXA },
      shading: { fill, type: ShadingType.CLEAR },
      borders: borders("CCCCCC"),
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text, size: 18, font: FONT, color: "333333", bold: !!bold })] })]
    }))
  }));

  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2200, 1800, 1800, 2200, 1360],
    rows: [headerRow, ...dataRows]
  });
}

// KPI table
function kpiTable(rows) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [3000, 2120, 2120, 2120],
    rows: [
      new TableRow({
        children: [["KPI", 3000], ["Фаз 1 зорилт", 2120], ["Фаз 2 зорилт", 2120], ["Фаз 3+ зорилт", 2120]].map(([label, w]) =>
          new TableCell({
            width: { size: w, type: WidthType.DXA },
            shading: { fill: COLOR_GREEN, type: ShadingType.CLEAR },
            borders: borders(COLOR_GREEN),
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20, font: FONT, color: "FFFFFF" })] })]
          })
        )
      }),
      ...rows.map(([kpi, p1, p2, p3], i) => new TableRow({
        children: [[kpi, 3000], [p1, 2120], [p2, 2120], [p3, 2120]].map(([text, w]) =>
          new TableCell({
            width: { size: w, type: WidthType.DXA },
            shading: { fill: i % 2 === 0 ? COLOR_GREEN_LIGHT : "FFFFFF", type: ShadingType.CLEAR },
            borders: borders("BBCCBB"),
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text, size: 20, font: FONT, color: "333333" })] })]
          })
        )
      }))
    ]
  });
}

const doc = new Document({
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 560, hanging: 280 } } }
        }]
      }
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }
      }
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          children: [
            new TextRun({ text: "LLM Agentic System — Төслийн Гүйцэтгэлийн Төлөвлөгөө", size: 18, font: FONT, color: COLOR_GRAY }),
            new TextRun({ text: "    |    2026", size: 18, font: FONT, color: COLOR_GRAY })
          ],
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR_MID, space: 4 } }
        })]
      })
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "Хуудас ", size: 18, font: FONT, color: COLOR_GRAY }),
            new PageNumber()
          ],
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: COLOR_MID, space: 4 } }
        })]
      })
    },
    children: [
      // ═══════════════════════════════
      // COVER
      // ═══════════════════════════════
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "LLM AGENTIC SYSTEM", bold: true, size: 64, color: COLOR_DARK, font: FONT })],
        spacing: { before: 800, after: 160 }
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "Төслийн Гүйцэтгэлийн Төлөвлөгөө", size: 40, color: COLOR_ACCENT, font: FONT })],
        spacing: { before: 0, after: 80 }
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "Enterprise-Grade · Scale-Ready · Phased Approach", size: 22, color: COLOR_GRAY, font: FONT })],
        spacing: { before: 0, after: 600 }
      }),

      // Summary box
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [2340, 2340, 2340, 2340],
        rows: [new TableRow({
          children: [
            ["4 Фаз", "Хэрэгжүүлэлт", COLOR_ACCENT],
            ["12+ сар", "Нийт хугацаа", COLOR_DARK],
            ["PoC → Scale", "Өсөлтийн зам", COLOR_GREEN],
            ["MCP суурь", "Эхний алхам", COLOR_ORANGE]
          ].map(([main, sub, col]) => new TableCell({
            width: { size: 2340, type: WidthType.DXA },
            shading: { fill: col, type: ShadingType.CLEAR },
            borders: { top: noBorder, bottom: noBorder, left: noBorder, right: { style: BorderStyle.SINGLE, size: 8, color: "FFFFFF" } },
            margins: { top: 200, bottom: 200, left: 200, right: 200 },
            verticalAlign: VerticalAlign.CENTER,
            children: [
              new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: main, bold: true, size: 40, color: "FFFFFF", font: FONT })] }),
              new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: sub, size: 20, color: "EEEEEE", font: FONT })] }),
            ]
          }))
        })]
      }),

      spacer(600),

      // ═══════════════════════════════
      // SECTION 1: OVERVIEW
      // ═══════════════════════════════
      h1("1. Товч Танилцуулга"),
      para("Энэхүү төлөвлөгөө нь байгууллагын мэдлэгийн сан болон дата баазтай холбогдсон LLM-д суурилсан Agentic системийг 4 үе шаттайгаар хэрэгжүүлэх практик замыг тодорхойлно. Масштаблах боломжтой байхаар зохиогдсон тул фаз бүрийг бие даан дүгнэж, дараагийн фаз руу шилжих шийдвэр гаргаж болно."),
      spacer(80),
      infoTable([
        ["Хүрэх зорилго", "Байгууллагын өгөгдөлтэй ажилладаг, олон агентаас бүрдсэн, аюулгүй, хэмжиж болохуйц AI туслах систем", false],
        ["Суурь архитектур", "MCP + RAG + Multi-Agent Orchestration + Observability", false],
        ["Технологийн хэл", "TypeScript (Node.js) эсвэл Python — фаз 1-д аль нэгийг сонгоно", false],
        ["Масштаблах зарчим", "PoC (1 хүн, 1 tool) → Пилот (баг, олон tool) → Продакшн (бүх байгууллага)", false],
      ]),

      spacer(200),

      // ═══════════════════════════════
      // SECTION 2: PHASES
      // ═══════════════════════════════
      h1("2. Хэрэгжүүлэлтийн Фазууд"),

      h2("Фаз 1 — PoC: MCP Суурийг Тавих", COLOR_ACCENT),
      para("Зорилго: LLM, Agent, RAG нэмэхгүйгээр зөвхөн нэг дата баазтай холбогдсон MCP сервер ажиллуулж, Claude Desktop-тай холбоно. Энэ нь технологийн баталгаа (Technical Proof) болно."),
      spacer(80),
      phaseCard(
        1, "MCP PoC", "4-6 долоо хоног",
        COLOR_ACCENT, COLOR_LIGHT,
        [
          "MCP SDK суурилуулах (TypeScript эсвэл Python)",
          "Байгууллагын 1 дата баазтай холбох (зөвхөн SELECT)",
          "5-10 хэрэгцээтэй tool тодорхойлох (get_sales, get_kpi гэх мэт)",
          "Pydantic/Zod-оор input/output баталгаажуулалт",
          "Claude Desktop апп-тай холбож тест хийх",
          "Аюулгүй байдлын тохиргоо (Read-Only, env variables)"
        ],
        [
          "Ажиллаж байгаа MCP сервер",
          "Claude Desktop-ээр асуулт асуух боломж",
          "Техникийн баримт бичиг",
          "Хяналтын журнал (logs)"
        ],
        "Claude Desktop-ийн хариулт бодит дата харуулж байна"
      ),

      spacer(160),
      h2("Фаз 2 — Пилот: RAG + Agent нэмэх", COLOR_GREEN),
      para("Зорилго: Фаз 1-ийн MCP сервер дээр Vector DB болон LLM Agent нэмж, байгууллагын баримт бичгийг ойлгож хариулах чадварыг нэмэгдүүлнэ. Жижиг баг (2-3 хүн) ашиглана."),
      spacer(80),
      phaseCard(
        2, "RAG + Agent", "6-8 долоо хоног",
        COLOR_GREEN, COLOR_GREEN_LIGHT,
        [
          "Vector DB сонгох, суурилуулах (Qdrant эсвэл локал Chroma)",
          "Байгууллагын баримт бичгийг embedding хийж индексжүүлэх",
          "Hybrid search (BM25 + Semantic) хэрэгжүүлэх",
          "LangGraph/Mastra ашиглан Agent loop бүтээх",
          "Context pruning (prompt compression) хэрэгжүүлэх",
          "Langfuse-ийн trace/logging холбох",
          "5-10 хэрэглэгчтэй пилот тест",
          "Eval багц бэлдэж хариултын чанар хэмжих"
        ],
        [
          "RAG pipeline ажиллаж байгаа",
          "Agent planning + tool use хийж чадна",
          "Langfuse dashboard ажиллаж байгаа",
          "Eval тайлан (accuracy, latency)"
        ],
        "Байгууллагын баримтаас хариулт өгч чадна"
      ),

      spacer(160),
      h2("Фаз 3 — Продакшн: Multi-Agent + Хяналт", COLOR_ORANGE),
      para("Зорилго: Нэг агентаас олон агент руу шилжиж, Санхүүгийн, Хуулийн, Техникийн зэрэг мэргэшсэн агентуудыг нэмнэ. Байгууллагын бүх хэрэглэгчдэд нээнэ."),
      spacer(80),
      phaseCard(
        3, "Multi-Agent", "8-10 долоо хоног",
        COLOR_ORANGE, COLOR_ORANGE_LIGHT,
        [
          "Router Agent хөгжүүлэх (асуултыг тохирох агент руу чиглүүлнэ)",
          "Domain агентуудыг тусад нь бүтээх (Finance, Legal, Technical)",
          "Row-Level Security MCP давхарга дээр хэрэгжүүлэх",
          "Code Execution Sandbox (E2B эсвэл Docker) нэмэх",
          "Redis/PostgreSQL-д харилцан ярианы санах ой хадгалах",
          "API gateway + rate limiting тохируулах",
          "Алдааны нөхцлийг (fallback) зохицуулах",
          "Load test хийж гүйцэтгэлийг хэмжих"
        ],
        [
          "Multi-agent routing ажиллаж байгаа",
          "Code sandbox дотор Python ажиллана",
          "RBAC + RLS хэрэгжсэн",
          "100+ хэрэглэгчийн load тест давсан"
        ],
        "Байгууллагын бүх хэрэглэгч ашиглах боломжтой"
      ),

      spacer(160),
      h2("Фаз 4 — Масштаблах: Оновчлол + Өргөтгөл", COLOR_RED),
      para("Зорилго: Системийг байнгын өсөлтэд бэлдэх — автоматжуулалт, шинэ мэдлэгийн эх сурвалж, нарийн хяналт нэмнэ."),
      spacer(80),
      phaseCard(
        4, "Scale & Optimize", "Тасралтгүй",
        COLOR_RED, COLOR_RED_LIGHT,
        [
          "Шинэ MCP серверүүд нэмэх (Jira, Confluence, ERP гэх мэт)",
          "Embedding загварыг байгууллагын өгөгдлөөр fine-tune хийх",
          "CI/CD pipeline-д автомат eval тест нэмэх",
          "A/B тест — өөр LLM загваруудыг харьцуулах",
          "Зардлын хяналт — token usage dashboard",
          "Хэрэглэгчийн санал хүсэлтийн feedback loop",
          "Шинэ хэлтэс/систем нэмэх",
          "Жил тутмын архитектурын хяналт"
        ],
        [
          "Шинэ системүүдтэй интеграц",
          "Загварын гүйцэтгэл сайжирсан",
          "Зардлын тайлан",
          "Хэрэглэгчийн сэтгэл ханамжийн судалгаа"
        ],
        "Системийг байнга хөгжүүлэх циклд оруулсан"
      ),

      spacer(200),

      // ═══════════════════════════════
      // SECTION 3: TECH STACK
      // ═══════════════════════════════
      h1("3. Технологийн Стекийн Шилжилт (Scale Path)"),
      para("Фаз бүрт технологийн хариуцлагыг аажмаар нэмэгдүүлнэ. Эхний шатанд хамгийн хялбар хэрэгслийг ашиглаж, туршлага хуримтлуулсны дараа байгууллагын шаардлагад нийцсэн хэрэгсэл рүү шилжинэ."),
      spacer(80),
      stackTable([
        ["LLM загвар", "Claude API (Sonnet)", "Claude / GPT-4o", "Олон загвар A/B тест", "Fine-tuned загвар"],
        ["Agent Framework", "Шууд API дуудлага", "LangGraph эсвэл Mastra", "Multi-agent LangGraph", "Custom orchestrator"],
        ["Vector DB", "–", "Chroma (локал)", "Qdrant (cloud)", "Qdrant cluster"],
        ["MCP Tools", "1-2 tool (SQL)", "5-10 tool", "20+ tool, олон систем", "Бүх байгууллагын систем"],
        ["Observability", "Console logs", "Langfuse (cloud)", "Langfuse self-hosted", "Custom dashboard"],
        ["Санах ой", "–", "PostgreSQL", "Redis + PostgreSQL", "Distributed cache"],
        ["Аюулгүй байдал", "Read-Only SQL", "RBAC тохиргоо", "Row-Level Security", "Zero-trust model"],
        ["Ажиллуулах орчин", "Локал / Desktop", "Docker Compose", "Kubernetes (k8s)", "Multi-region k8s"],
      ]),

      spacer(200),

      // ═══════════════════════════════
      // SECTION 4: KPI
      // ═══════════════════════════════
      h1("4. Амжилтын Үзүүлэлтүүд (KPI)"),
      para("Фаз бүрт доорх хэмжүүрүүдийг хэмжиж, дараагийн фаз руу шилжих шийдвэр гаргана."),
      spacer(80),
      kpiTable([
        ["Хариултын нарийвчлал (Accuracy)", "≥ 70% (тест 20 асуулт)", "≥ 85%", "≥ 92%"],
        ["Хариултын хугацаа (Latency)", "< 10 сек", "< 5 сек", "< 3 сек"],
        ["Tool call амжилт (Success rate)", "≥ 80%", "≥ 92%", "≥ 98%"],
        ["Хэрэглэгчийн тоо", "1-3 хүн (тест)", "10-50 хүн", "Бүх байгууллага"],
        ["Хяналтын бүрхэлт (Observability)", "Console log", "100% Langfuse trace", "Realtime dashboard"],
        ["Систем тасралтгүй ажиллах (Uptime)", "–", "≥ 95%", "≥ 99.5%"],
      ]),

      spacer(200),

      // ═══════════════════════════════
      // SECTION 5: RISKS
      // ═══════════════════════════════
      h1("5. Эрсдэлийн Удирдлага"),
      spacer(80),
      riskTable([
        ["LLM буруу хариулт өгөх (Hallucination)", "Өндөр", "Өндөр", "Eval тест + Human-in-the-loop баталгаажуулалт", COLOR_RED_LIGHT],
        ["Мэдээллийн аюулгүй байдал зөрчигдөх", "Маш өндөр", "Дунд", "Read-Only SQL + RBAC + RLS + аудит лог", COLOR_ORANGE_LIGHT],
        ["Гүйцэтгэлийн саатал (Latency)", "Дунд", "Өндөр", "Context pruning + Async tool call + Caching", COLOR_ORANGE_LIGHT],
        ["Хэрэглэгчийн хүлээн авалт муу", "Өндөр", "Дунд", "Пилот тест + UX сайжруулалт + Сургалт", COLOR_ORANGE_LIGHT],
        ["Vendor lock-in (нэг LLM-д хамааралтай)", "Дунд", "Бага", "Abstraction layer + Олон загвар дэмжих бүтэц", COLOR_GREEN_LIGHT],
        ["Зардлын өсөлт (Token cost)", "Дунд", "Өндөр", "Token budget + Caching + Prompt compression", COLOR_ORANGE_LIGHT],
      ]),

      spacer(200),

      // ═══════════════════════════════
      // SECTION 6: TEAM
      // ═══════════════════════════════
      h1("6. Баг болон Хариуцлага"),
      spacer(80),
      infoTable([
        ["Үүрэг", "Хариуцах хэсэг", true],
        ["AI/Backend Engineer (1-2)", "MCP сервер, Agent framework, Vector DB, API", false],
        ["Data Engineer (1)", "Өгөгдлийн чанар, embedding pipeline, SQL оптимизаци", false],
        ["DevOps / Infra (1)", "Docker/k8s, CI/CD, Observability, Security", false],
        ["Domain Expert (1-2)", "Eval тест бэлдэх, хариултын чанар дүгнэх, prompt сайжруулах", false],
        ["Product Owner (1)", "KPI тодорхойлох, хэрэглэгчтэй холбоос, шийдвэр гаргах", false],
      ], [2800, 6560]),

      spacer(200),

      // ═══════════════════════════════
      // SECTION 7: FIRST STEPS
      // ═══════════════════════════════
      h1("7. Одоо Хийх Эхний 5 Алхам"),
      spacer(80),
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [700, 5460, 3200],
        rows: [
          [["#", 700], ["Алхам", 5460], ["Хугацаа / Хариуцагч", 3200]],
          [["1", 700], ["MCP SDK суурилуулах: npm install @modelcontextprotocol/sdk", 5460], ["1 хоног / Backend Engineer", 3200]],
          [["2", 700], ["Байгууллагын 1 дата баазын read-only эрхтэй холболт тохируулах", 5460], ["2-3 хоног / Data Engineer", 3200]],
          [["3", 700], ["5 үндсэн tool тодорхойлж, Pydantic/Zod схем бичих", 5460], ["3-5 хоног / AI Engineer", 3200]],
          [["4", 700], ["Claude Desktop-тай холбож, 20 жишээ асуултаар тест хийх", 5460], ["1-2 хоног / Бүх баг", 3200]],
          [["5", 700], ["Тестийн үр дүнг баримтжуулж, Фаз 2 руу шилжих шийдвэр гаргах", 5460], ["1 хоног / Product Owner", 3200]],
        ].map(([n, step, owner], i) => new TableRow({
          children: [
            [n, 700],
            [step, 5460],
            [owner, 3200]
          ].map(([text, w]) => new TableCell({
            width: { size: w, type: WidthType.DXA },
            shading: { fill: i === 0 ? COLOR_DARK : (i % 2 === 0 ? COLOR_GRAY_LIGHT : "FFFFFF"), type: ShadingType.CLEAR },
            borders: borders(i === 0 ? COLOR_DARK : "CCCCCC"),
            margins: { top: 100, bottom: 100, left: 140, right: 140 },
            children: [new Paragraph({
              children: [new TextRun({ text, bold: i === 0, size: 20, font: FONT, color: i === 0 ? "FFFFFF" : "333333" })]
            })]
          }))
        }))
      }),

      spacer(200),

      // ═══════════════════════════════
      // CLOSING NOTE
      // ═══════════════════════════════
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [9360],
        rows: [new TableRow({
          children: [new TableCell({
            width: { size: 9360, type: WidthType.DXA },
            shading: { fill: COLOR_DARK, type: ShadingType.CLEAR },
            borders: borders(COLOR_DARK),
            margins: { top: 200, bottom: 200, left: 240, right: 240 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: "Гол зарчим: Алхам бүрийг дүгнэж, дараагийн шат руу шилж.", bold: true, size: 24, color: "FFFFFF", font: FONT })],
                spacing: { before: 0, after: 80 }
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: "Фаз 1-ийн MCP PoC 2 долоо хоногт бэлэн болно — өнөөдөр эхлэх боломжтой.", size: 20, color: "CCDDFF", font: FONT })]
              })
            ]
          })]
        })]
      }),

      spacer(80),
    ]
  }]
});

const buffer = await Packer.toBuffer(doc);
fs.writeFileSync('/home/claude/LLM_project_plan.docx', buffer);
console.log('Done!');
