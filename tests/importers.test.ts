import { describe, expect, it } from "vitest";
import { parseAmount, parseCsv, parseDate, previewCsv } from "@/lib/importers/csv";
import { parseOfx } from "@/lib/importers/ofx";

describe("CSV", () => {
  it("parse les montants FR et EN", () => {
    expect(parseAmount("1 234,56 €")).toBe(1234.56);
    expect(parseAmount("-1,234.56")).toBe(-1234.56);
    expect(parseAmount("(12.00)")).toBe(-12);
    expect(parseAmount("")).toBeNull();
  });

  it.each([
    ["1.234,56", 1234.56], ["1\u202f234,56 €", 1234.56],
    ["1,234,567.89", 1234567.89], ["1.234.567", 1234567],
    ["12,50-", -12.5], ["−12,50", -12.5], ["-€12.50", -12.5], ["0", 0],
  ])("conserve les centimes de %s", (raw, expected) => {
    expect(parseAmount(String(raw))).toBe(expected);
  });

  it.each(["1,234", "1.234", "0.001", "1e3", "0x10", "Infinity", "1 2", "1,23.45", "12€34", "€12$", "(-12)", "1000000000000"])("rejette le montant ambigu ou invalide %s", (raw) => {
    expect(parseAmount(raw)).toBeNull();
  });

  it("parse les dates selon le format", () => {
    expect(parseDate("03/02/2026", "dmy")).toBe("2026-02-03");
    expect(parseDate("2026-02-03", "ymd")).toBe("2026-02-03");
    expect(parseDate("31/02/2026", "dmy")).toBeNull();
    expect(parseDate("29/02/2024", "dmy")).toBe("2024-02-29");
    expect(parseDate("2026-02-03T12:30:00+01:00", "ymd")).toBe("2026-02-03");
    expect(parseDate("03/02/26", "dmy")).toBe("2026-02-03");
    expect(parseDate("0099-02-03", "ymd")).toBe("0099-02-03");
  });

  it.each(["29/02/2026", "00/03/2026", "03//2026", "1e1/02/2026", "03/02/2026 texte", "03/02/2026T99:00", "03/02/0000", "03/02/026"])("rejette une date erronée sans la normaliser : %s", (raw) => {
    expect(parseDate(raw, "dmy")).toBeNull();
  });

  it("détecte un mapping débit/crédit et importe", () => {
    const csv = "﻿Date;Libellé;Débit;Crédit\n03/02/2026;CB NETFLIX.COM;13,49;\n05/02/2026;VIR SALAIRE ACME;;2 100,00\n;ligne cassée;1;\n";
    const preview = previewCsv(csv);
    expect(preview.mapping).toMatchObject({ date: "Date", label: "Libellé", debit: "Débit", credit: "Crédit", dateFormat: "dmy" });
    const { rows, invalid } = parseCsv(csv, preview.mapping!);
    expect(rows).toEqual([
      { bookedAt: "2026-02-03", amount: -13.49, labelRaw: "CB NETFLIX.COM" },
      { bookedAt: "2026-02-05", amount: 2100, labelRaw: "VIR SALAIRE ACME" },
    ]);
    expect(invalid).toHaveLength(1);
  });

  it("détecte un montant signé", () => {
    const csv = "date,description,amount\n2026-02-03,Spotify,-10.99\n";
    const preview = previewCsv(csv);
    expect(preview.mapping).toMatchObject({ amount: "amount", dateFormat: "ymd" });
    expect(parseCsv(csv, preview.mapping!).rows[0].amount).toBe(-10.99);
  });

  it("écarte les débits/crédits illisibles ou contradictoires au lieu d'en calculer un faux net", () => {
    const csv = "Date;Libellé;Débit;Crédit\n03/02/2026;Débit cassé;illisible;100\n03/02/2026;Crédit cassé;100;illisible\n03/02/2026;Deux montants;100;200\n03/02/2026;Crédit négatif;;-200\n03/02/2026;Débit valide;-12,50;0\n";
    const result = parseCsv(csv, previewCsv(csv).mapping!);
    expect(result.rows).toEqual([{ bookedAt: "2026-02-03", amount: -12.5, labelRaw: "Débit valide" }]);
    expect(result.invalid).toEqual([2, 3, 4, 5].map((line) => ({ line, reason: "montant illisible" })));
  });

  it("écarte les lignes ayant trop ou pas assez de colonnes", () => {
    const csv = "Date;Libellé;Montant\n03/02/2026;Marchand;100;200\n03/02/2026;Incomplet\n03/02/2026;Valide;12,50\n";
    const result = parseCsv(csv, previewCsv(csv).mapping!);
    expect(result.rows).toEqual([{ bookedAt: "2026-02-03", amount: 12.5, labelRaw: "Valide" }]);
    expect(result.invalid).toEqual([2, 3].map((line) => ({ line, reason: "nombre de colonnes incorrect" })));
  });

  it("refuse tout le fichier si les colonnes sont dupliquées ou les guillemets cassés", () => {
    const mapping = { date: "Date", label: "Libellé", amount: "Montant", dateFormat: "dmy" as const };
    for (const csv of [
      "Date;Libellé;Montant;Montant\n03/02/2026;Marchand;10;1000\n",
      'Date;Libellé;Montant\n03/02/2026;Valide;10\n03/02/2026;"non fermé;100\n',
    ]) {
      const result = parseCsv(csv, mapping);
      expect(result.rows).toEqual([]);
      expect(result.error).toBeTruthy();
    }
  });

  it("refuse un mapping incomplet ou réutilisant la même colonne", () => {
    const csv = "Date;Libellé;Montant\n03/02/2026;Marchand;12\n";
    for (const amount of ["Date", "absent"]) {
      expect(parseCsv(csv, { date: "Date", label: "Libellé", amount, dateFormat: "dmy" })).toMatchObject({ rows: [], error: expect.any(String) });
    }
  });
});

describe("OFX", () => {
  it("lit les blocs STMTTRN en SGML", () => {
    const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260203<TRNAMT>-13.49<FITID>1<NAME>NETFLIX.COM<MEMO>CB 03/02
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260205120000<TRNAMT>2100,00<FITID>2<NAME>SALAIRE ACME &amp; CO
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const { rows, invalid } = parseOfx(ofx);
    expect(invalid).toEqual([]);
    expect(rows).toEqual([
      { bookedAt: "2026-02-03", amount: -13.49, labelRaw: "NETFLIX.COM CB 03/02" },
      { bookedAt: "2026-02-05", amount: 2100, labelRaw: "SALAIRE ACME & CO" },
    ]);
  });

  const transaction = (date: string, amount: string, label = "Marchand") => `<STMTTRN><DTPOSTED>${date}</DTPOSTED><TRNAMT>${amount}</TRNAMT><NAME>${label}</NAME></STMTTRN>`;
  const statement = (type: "bank" | "card", account: string) => {
    const [outer, inner] = type === "bank" ? ["STMTRS", "BANKACCTFROM"] : ["CCSTMTRS", "CCACCTFROM"];
    return `<${outer}><${inner}><ACCTID>${account}</ACCTID></${inner}><BANKTRANLIST>${transaction("20260203", "-12.50")}</BANKTRANLIST></${outer}>`;
  };

  it.each(["bank", "card"] as const)("refuse globalement plusieurs comptes OFX (%s), sans aucune ligne importable", (type) => {
    const result = parseOfx(`<OFX>${statement("bank", "A")}${statement(type, "B")}</OFX>`);
    expect(result.rows).toEqual([]);
    expect(result.error).toContain("un seul compte par fichier");
  });

  it("conserve un relevé XML mono-compte et ses entités sans double décodage", () => {
    const ofx = `<OFX><STMTRS><BANKACCTFROM><ACCTID>A</ACCTID></BANKACCTFROM><BANKTRANLIST>${transaction("20260203123000.000[+1:CET]", "-12.50", "Caf&#233; &amp; Co &amp;lt;")}</BANKTRANLIST></STMTRS></OFX>`;
    expect(parseOfx(ofx)).toEqual({ rows: [{ bookedAt: "2026-02-03", amount: -12.5, labelRaw: "Café & Co &lt;" }], invalid: [] });
  });

  it("écarte les dates et montants OFX invalides sans altérer les autres opérations", () => {
    const ofx = `<OFX><BANKTRANLIST>${transaction("20260230", "-12.50")}${transaction("20260203garbage", "-12.50")}${transaction("20260203", "0x10")}${transaction("20260203", "1.005")}${transaction("20260203", "-12.50")}</BANKTRANLIST></OFX>`;
    const result = parseOfx(ofx);
    expect(result.rows).toEqual([{ bookedAt: "2026-02-03", amount: -12.5, labelRaw: "Marchand" }]);
    expect(result.invalid).toHaveLength(4);
  });
});
