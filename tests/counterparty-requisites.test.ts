import { describe, expect, it } from "vitest";
import {
  inferPaymentMethod,
  sectionsToRequisitePayloads,
  splitRequisites,
} from "../lib/counterparty-requisites";

describe("splitRequisites", () => {
  it("раскладывает смешанную строку на отдельные списки", () => {
    const result = splitRequisites([
      {
        id: "r1",
        taxId: "7701234567",
        accountNumber: "40702810100000000001",
        bankName: "Тинькофф",
        bic: "044525974",
        cardNumber: "220070******1234",
      },
    ]);

    expect(result.taxIds).toEqual([{ id: "r1", isNew: false, taxId: "7701234567" }]);
    expect(result.accounts[0]).toMatchObject({
      isNew: true,
      accountNumber: "40702810100000000001",
      bankName: "Тинькофф",
      bic: "044525974",
    });
    expect(result.cards[0]).toMatchObject({
      isNew: true,
      cardNumber: "220070******1234",
      bankName: "Тинькофф",
    });
  });

  it("пустые строки помечает leftover", () => {
    expect(splitRequisites([{ id: "empty" }]).leftoverIds).toEqual(["empty"]);
  });
});

describe("sectionsToRequisitePayloads", () => {
  it("не тащит способ оплаты в UI-смысле и режет пустые значения", () => {
    const payloads = sectionsToRequisitePayloads({
      taxIds: [{ taxId: " 7701 " }, { taxId: "  " }],
      accounts: [{ accountNumber: "40817", bankName: "Сбер", bic: "" }],
      cards: [{ cardNumber: "2200", bankName: "" }],
    });

    expect(payloads).toHaveLength(3);
    expect(payloads[0]).toMatchObject({ taxId: "7701", paymentMethod: "bank_transfer" });
    expect(payloads[1]).toMatchObject({ accountNumber: "40817", bankName: "Сбер" });
    expect(payloads[2]).toMatchObject({ cardNumber: "2200", paymentMethod: "card" });
  });
});

describe("inferPaymentMethod", () => {
  it("карту отличает от счёта", () => {
    expect(inferPaymentMethod({ cardNumber: "2200" })).toBe("card");
    expect(inferPaymentMethod({ accountNumber: "40817" })).toBe("bank_transfer");
  });
});
