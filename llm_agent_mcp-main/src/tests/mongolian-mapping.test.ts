import { describe, it, expect } from "vitest";

describe("Mongolian Column Name Mapping", () => {
    // Replicate Rule 23 logic
    const MONGOLIAN_MAP: Record<string, string> = {
        "үнэлгээ": "rating",
        "салбар": "branch",
        "бүтээгдэхүүн": "type",
        "төрөл": "category",
        "хэлбэр": "status",
        "огноо": "date",
        "борлуулалт": "sales_amount",
        "тоо": "quantity",
        "үнэ": "price",
        "орлого": "income",
        "зарлага": "expense",
        "ашиг": "profit",
        "хэрэглэгч": "customer_id",
        "нэр": "name",
        "хаяг": "address",
    };

    function mapMongolianColumn(col: string): string {
        const lower = col.toLowerCase().trim();
        return MONGOLIAN_MAP[lower] || col;
    }

    it("should map огноо to date", () => {
        expect(mapMongolianColumn("огноо")).toBe("date");
    });

    it("should map борлуулалт to sales_amount", () => {
        expect(mapMongolianColumn("борлуулалт")).toBe("sales_amount");
    });

    it("should map салбар to branch", () => {
        expect(mapMongolianColumn("салбар")).toBe("branch");
    });

    it("should map бүтээгдэхүүн to type", () => {
        expect(mapMongolianColumn("бүтээгдэхүүн")).toBe("type");
    });

    it("should map хэрэглэгч to customer_id", () => {
        expect(mapMongolianColumn("хэрэглэгч")).toBe("customer_id");
    });

    it("should pass through unknown columns unchanged", () => {
        expect(mapMongolianColumn("unknown_column")).toBe("unknown_column");
    });

    it("should map үнэлгээ to rating", () => {
        expect(mapMongolianColumn("үнэлгээ")).toBe("rating");
    });

    it("should be case-insensitive", () => {
        expect(mapMongolianColumn("ОГНОО")).toBe("date");
    });

    it("should map ашиг to profit", () => {
        expect(mapMongolianColumn("ашиг")).toBe("profit");
    });

    it("should map орлого to income", () => {
        expect(mapMongolianColumn("орлого")).toBe("income");
    });
});
