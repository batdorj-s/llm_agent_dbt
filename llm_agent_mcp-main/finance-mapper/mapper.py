#!/usr/bin/env python3
"""
mapper.py — AI-powered schema mapper for financial data.

Usage:
    python3 mapper.py <input_csv_or_xlsx>

Takes a random CSV/Excel financial file, uses OpenAI to map its columns
to the target Mongolian schema (sar_*.xlsx format), transforms the data,
and saves as sar_N.xlsx in the project data directory.

Output: JSON to stdout ONLY (all other prints suppressed via logging).
"""

import json
import os
import re
import sys
from pathlib import Path
from typing import Optional

import pandas as pd
from dotenv import load_dotenv
from openai import OpenAI

# ── Config ────────────────────────────────────────────────────────────

TARGET_SCHEMA = [
    "Өдөр",
    "Харилцагч",
    "Дүн",
    "Ангилал",
    "Дэд ангилал",
    "Тайлбар",
]

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# Load .env from project root
PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

# ── Logger (suppress all non-JSON output) ────────────────────────────


class _SilentLogger:
    def __getattr__(self, _):
        return lambda *_, **__: None


logger = _SilentLogger()
log = logger  # alias used inside mapper


def emit_result(result: dict) -> None:
    """Print JSON result to stdout — the ONLY allowed stdout output."""
    print(json.dumps(result, ensure_ascii=False, default=str))
    sys.stdout.flush()


# ── Step 1: Read input ───────────────────────────────────────────────


def read_input(file_path: str) -> tuple[pd.DataFrame, list[str], list[dict]]:
    ext = Path(file_path).suffix.lower()
    if ext in (".xlsx", ".xls"):
        df = pd.read_excel(file_path, engine="openpyxl")
    elif ext == ".csv":
        df = pd.read_csv(file_path)
    else:
        raise ValueError(f"Unsupported file type: {ext}")

    if df.empty:
        raise ValueError("File is empty")

    columns = list(df.columns)
    # Convert NaN/NaT to None for clean JSON serialization
    sample_rows = df.head(5).where(df.notna(), None).to_dict(orient="records")
    return df, columns, sample_rows


# ── Step 2: AI Schema Mapping ────────────────────────────────────────


def detect_mapping(columns: list[str], sample_rows: list[dict]) -> dict:
    # Try GROQ first (primary project provider), fall back to OpenAI
    groq_key = os.getenv("GROQ_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")

    if groq_key:
        client = OpenAI(
            api_key=groq_key,
            base_url="https://api.groq.com/openai/v1",
        )
        model = "llama-3.3-70b-versatile"
    elif openai_key:
        client = OpenAI(api_key=openai_key)
        model = "gpt-4o-mini"
    else:
        raise ValueError("No LLM API key found. Set GROQ_API_KEY or OPENAI_API_KEY in .env")

    sample_json = json.dumps(sample_rows[:3], ensure_ascii=False)

    # Collect unique (Ангилал-like, Тайлбар-like) pairs for subcategory inference
    cat_col = next((c for c in columns if any(k in c.lower() for k in ["type", "category", "kind", "төрөл", "ангилал"])), None)
    note_col = next((c for c in columns if any(k in c.lower() for k in ["note", "desc", "тайлбар", "дэлгэрэнгүй"])), None)

    unique_pairs = []
    if cat_col or note_col:
        seen = set()
        for row in sample_rows[:5]:
            cat_val = str(row.get(cat_col, "") or "") if cat_col else ""
            note_val = str(row.get(note_col, "") or "") if note_col else ""
            pair = (cat_val, note_val)
            if pair not in seen and (cat_val or note_val):
                seen.add(pair)
                unique_pairs.append({"category": cat_val, "description": note_val})

    unique_json = json.dumps(unique_pairs, ensure_ascii=False) if unique_pairs else "[]"

    prompt = f"""You are an expert financial data mapping and categorization assistant.
I have raw financial data with these columns: {columns}
Here is a sample of the data: {sample_json}

Map the raw columns to the target schema (6 columns):
1. "Өдөр" — Date (any format: '5-Jan', 'YYYY-MM-DD', '2026-01-05', etc.)
2. "Харилцагч" — Customer or counterparty name
3. "Дүн" — Monetary amount (integer or float)
4. "Ангилал" — Transaction category
5. "Дэд ангилал" — Subcategory: If the raw data has an explicit column, map it directly. IF NOT, infer using the 'inferred_subcategories' ruleset below.
6. "Тайлбар" — Description or note (use null if not found)

Additionally, if no column matches 'Дэд ангилал', generate an 'inferred_subcategories' ruleset.
Here are the unique (category, description) pairs from the data:
{unique_json}

Assign each pair a logical subcategory (e.g. 'Оффис', 'Түрээс', 'Касс', 'ҮАЗ', 'Цалин', 'Хүнс', 'Тээвэр', 'Хэрэгсэл', 'Салбар шилжүүлэг', 'Зээл').
If a pair clearly matches a subcategory by keyword, use it. Otherwise use 'Бусад'.

Return ONLY valid JSON with NO extra text:
{{
  "mapping": [
    {{"original": "input_col_name", "target": "Өдөр", "note": "why mapped or inferred"}},
    ...
  ],
  "date_format": "Detected date format like DD-Mon-YYYY or YYYY-MM-DD",
  "amount_column": "name of the monetary amount column",
  "inferred_subcategories": {{
    "Касс": "касс,cash",
    "Түрээс": "rent,lease,түрээс",
    "Цалин": "salary,цалин,payroll"
  }}
}}

Rules:
- Every input column should appear in mapping list exactly once.
- If a target column has no match, set target to null for that original column.
- If input columns have no match in target, set target to null.
- Output column order must match target schema order.
- The mapping list length must equal number of input columns.
- If Дэд ангилал is not matched to any input column, include 'inferred_subcategories' as a keyword-to-subcategory mapping.
- The inferred_subcategories keys are subcategory names, values are comma-separated lowercase keywords. If any keyword appears in the category or description text, assign that subcategory."""

    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": "You are a financial data mapper and categorization AI. Output ONLY valid JSON. No explanations, no markdown.",
            },
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.1,
        max_tokens=1000,
    )

    raw = response.choices[0].message.content
    if not raw:
        raise ValueError("Empty response from LLM")

    parsed = json.loads(raw)
    # Validate mapping structure
    if "mapping" not in parsed or not isinstance(parsed["mapping"], list):
        raise ValueError(f"LLM returned unexpected structure: {list(parsed.keys())}")

    return parsed


# ── Step 3: Transform ────────────────────────────────────────────────


def transform(df: pd.DataFrame, mapping_result: dict) -> pd.DataFrame:
    mapping_list = mapping_result["mapping"]
    date_format = mapping_result.get("date_format", "")
    amount_col = mapping_result.get("amount_column", "")

    # Build rename dict: original -> target (only non-null targets)
    rename = {}
    target_cols_found = set()
    for m in mapping_list:
        orig = m["original"]
        tgt = m["target"]
        if tgt and tgt in TARGET_SCHEMA:
            rename[orig] = tgt
            target_cols_found.add(tgt)

    # Rename columns
    df = df.rename(columns=rename)

    # Keep only target schema columns (in order), fill missing with empty string
    for col in TARGET_SCHEMA:
        if col not in df.columns:
            df[col] = ""

    df = df[TARGET_SCHEMA]

    # ── Type casting ──

    # Date: coerce to string
    df["Өдөр"] = df["Өдөр"].astype(str)

    # Amount: convert to numeric (handle ₮, commas, spaces)
    if amount_col and amount_col in rename:
        # The column was renamed to Дүн
        pass
    df["Дүн"] = (
        df["Дүн"]
        .astype(str)
        .str.replace(r"[₮$,€£¥\s]", "", regex=True)
        .str.replace(",", "")
        .pipe(pd.to_numeric, errors="coerce")
        .fillna(0)
    )

    # Apply inferred subcategories if Дэд ангилал has no explicit source column
    inferred = mapping_result.get("inferred_subcategories", {})
    if inferred and "Ангилал" in df.columns and "Тайлбар" in df.columns:
        def infer_subcat(row: pd.Series) -> str:
            cat = str(row.get("Ангилал", "") or "").lower()
            note = str(row.get("Тайлбар", "") or "").lower()
            text = f"{cat} {note}"
            for subcat, keywords in inferred.items():
                for kw in str(keywords).split(","):
                    if kw.strip().lower() in text:
                        return subcat
            return "Бусад"

        df["Дэд ангилал"] = df.apply(infer_subcat, axis=1)

    # Category, subcategory, description: string
    for col in ["Харилцагч", "Ангилал", "Дэд ангилал", "Тайлбар"]:
        df[col] = df[col].astype(str)

    return df


# ── Text-to-Table: Process Natural Language ──────────────────────────


def get_latest_sar_path(data_dir: Path) -> Optional[Path]:
    """Return the latest sar_N.xlsx path, or None if none exist."""
    os.makedirs(data_dir, exist_ok=True)
    pattern = re.compile(r"sar_(\d+)\.xlsx")
    max_n = 0
    latest = None
    for f in os.listdir(data_dir):
        m = pattern.match(f)
        if m:
            n = int(m.group(1))
            if n > max_n:
                max_n = n
                latest = data_dir / f
    return latest


def process_text_input(text_content: str) -> dict:
    """Extract structured financial data from natural language text."""
    groq_key = os.getenv("GROQ_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")

    if groq_key:
        client = OpenAI(
            api_key=groq_key,
            base_url="https://api.groq.com/openai/v1",
        )
        model = "llama-3.3-70b-versatile"
    elif openai_key:
        client = OpenAI(api_key=openai_key)
        model = "gpt-4o-mini"
    else:
        raise ValueError("No LLM API key found. Set GROQ_API_KEY or OPENAI_API_KEY in .env")

    today = "2026-07-31"
    prompt = f"""You are an expert financial data extraction assistant.

Analyze the following natural language sentence/context:
"{text_content}"

Extract financial transaction details and map them to this exact target schema:
{TARGET_SCHEMA}
(columns: Өдөр, Харилцагч, Дүн, Ангилал, Дэд ангилал, Тайлбар).

Rules:
1. If date is not mentioned, use today's date: {today}.
2. Extract customer name (Харилцагч) — the entity/person spending or receiving.
3. Extract amount (Дүн) — numeric only; strip currency symbols (₮$€£), commas, spaces.
4. Infer category (Ангилал) from context — common values: Зарлага (purchase/expense), Орлого (income/receipt), Дотоод шилжүүлэг (internal transfer). Default to Зарлага for most purchases.
5. Infer subcategory (Дэд ангилал) from context — e.g. Оффис, Түрээс, Хүнс, Тээвэр, Касс, ҮАЗ, Цалин, Хэрэгсэл, Салбар шилжүүлэг, Зээл, Бусад.
6. Description (Тайлбар) — the full original text.
7. Every field must have a value — no nulls.

For the explanation array, identify which specific keywords in the input text were used to extract each field. Be detailed and specific.

Return ONLY valid JSON with this exact structure:
{{
  "extracted_data": {{
    "Өдөр": "{today}",
    "Харилцагч": "Customer name",
    "Дүн": 45000.0,
    "Ангилал": "Зарлага",
    "Дэд ангилал": "Оффис",
    "Тайлбар": "Full original text"
  }},
  "explanation": [
    {{"original": "keyword from text", "target": "Өдөр", "note": "How date was determined"}},
    {{"original": "keyword from text", "target": "Харилцагч", "note": "Identified as customer name"}},
    {{"original": "keyword from text", "target": "Дүн", "note": "Monetary amount extracted"}},
    {{"original": "keyword from text", "target": "Ангилал", "note": "Category inference reasoning"}},
    {{"original": "keyword from text", "target": "Дэд ангилал", "note": "Subcategory inference reasoning"}},
    {{"original": "full text", "target": "Тайлбар", "note": "Full text stored as description"}}
  ]
}}

Make explanation items specific to the actual input text — show real keywords found."""

    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": "You are a financial data extraction AI. Output ONLY valid JSON. No explanations, no markdown.",
            },
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.1,
        max_tokens=1500,
    )

    raw = response.choices[0].message.content
    if not raw:
        raise ValueError("Empty response from LLM")

    parsed = json.loads(raw)
    if "extracted_data" not in parsed:
        raise ValueError(f"LLM returned unexpected structure: {list(parsed.keys())}")

    return parsed


def text_main(text_content: str) -> None:
    """Text-to-Table pipeline: extract -> append to sar_N.xlsx -> emit result."""
    try:
        result = process_text_input(text_content)
        extracted = result["extracted_data"]
        explanation = result.get("explanation", [])

        # Ensure numeric amount
        extracted["Дүн"] = pd.to_numeric(extracted.get("Дүн", 0), errors="coerce")

        # Find latest sar file to append, or create new
        latest = get_latest_sar_path(DATA_DIR)

        new_row = pd.DataFrame([extracted])

        if latest is not None:
            existing = pd.read_excel(latest)
            df = pd.concat([existing, new_row], ignore_index=True)
            output_path = latest
        else:
            df = new_row
            output_path = resolve_next_filename(DATA_DIR)

        df.to_excel(output_path, index=False, engine="openpyxl")

        # Preview after (last 3 rows)
        preview_after = df.tail(3).to_dict(orient="records")

        emit_result({
            "status": "success",
            "file_path": str(output_path),
            "mapping_explanation": explanation,
            "preview_data": {
                "before": [{"input_text": text_content}],
                "after": preview_after,
            },
        })

    except Exception as e:
        emit_result({
            "status": "error",
            "message": str(e),
            "error_type": type(e).__name__,
        })
        sys.exit(1)


# ── Step 4: Save ─────────────────────────────────────────────────────


def resolve_next_filename(data_dir: Path) -> Path:
    os.makedirs(data_dir, exist_ok=True)
    pattern = re.compile(r"sar_(\d+)\.xlsx")
    max_n = 0
    for f in os.listdir(data_dir):
        m = pattern.match(f)
        if m:
            n = int(m.group(1))
            if n > max_n:
                max_n = n
    next_n = max_n + 1
    return data_dir / f"sar_{next_n}.xlsx"


# ── Main Pipeline ────────────────────────────────────────────────────


def main(input_path: str):
    try:
        # Step 1: Read
        df, columns, sample_rows = read_input(input_path)

        # Step 2: AI detect mapping
        mapping_result = detect_mapping(columns, sample_rows)

        # Build mapping_explanation for output
        mapping_explanation = []
        for m in mapping_result["mapping"]:
            if m["target"]:
                mapping_explanation.append(m)
        # Also include target columns with no match
        matched_targets = {m["target"] for m in mapping_result["mapping"] if m["target"]}
        for col in TARGET_SCHEMA:
            if col not in matched_targets:
                inferred_note = "will be empty"
                if col == "Дэд ангилал" and mapping_result.get("inferred_subcategories"):
                    subcats = list(mapping_result["inferred_subcategories"].keys())
                    inferred_note = f"inferred from category/description — {', '.join(subcats[:5])}"
                mapping_explanation.append({
                    "original": None,
                    "target": col,
                    "note": f"No matching input column — {inferred_note}"
                })

        # Preview before
        preview_before = df.head(3).where(df.notna(), None).to_dict(orient="records")

        # Step 3: Transform
        df_transformed = transform(df, mapping_result)

        # Preview after
        preview_after = df_transformed.head(3).to_dict(orient="records")

        # Step 4: Save
        output_path = resolve_next_filename(DATA_DIR)
        df_transformed.to_excel(output_path, index=False, engine="openpyxl")

        emit_result({
            "status": "success",
            "file_path": str(output_path),
            "mapping_explanation": mapping_explanation,
            "preview_data": {
                "before": preview_before,
                "after": preview_after,
            },
        })

    except Exception as e:
        emit_result({
            "status": "error",
            "message": str(e),
            "error_type": type(e).__name__,
        })
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        emit_result({"status": "error", "message": "Usage: mapper.py <input_file_path> or mapper.py --text (read text from stdin)"})
        sys.exit(1)
    if sys.argv[1] == "--text":
        text = sys.stdin.read().strip()
        if not text:
            emit_result({"status": "error", "message": "No text provided via stdin"})
            sys.exit(1)
        text_main(text)
    else:
        main(sys.argv[1])
