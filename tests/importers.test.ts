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

  it("parse les dates selon le format", () => {
    expect(parseDate("03/02/2026", "dmy")).toBe("2026-02-03");
    expect(parseDate("2026-02-03", "ymd")).toBe("2026-02-03");
    expect(parseDate("31/02/2026", "dmy")).toBeNull();
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
});
