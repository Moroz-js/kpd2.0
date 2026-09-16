/**
 * Реквизиты в карточке — три независимых списка, без «способа оплаты».
 * В базе по-прежнему одна таблица: смешанные старые строки при открытии режем.
 */

export type RequisiteSource = {
  id: string;
  taxId?: string | null;
  bic?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  cardNumber?: string | null;
};

export type TaxIdDraft = { id: string; isNew: boolean; taxId: string };
export type AccountDraft = {
  id: string;
  isNew: boolean;
  accountNumber: string;
  bankName: string;
  bic: string;
};
export type CardDraft = { id: string; isNew: boolean; cardNumber: string; bankName: string };

export type RequisiteSections = {
  taxIds: TaxIdDraft[];
  accounts: AccountDraft[];
  cards: CardDraft[];
  leftoverIds: string[];
};

function filled(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function splitRequisites(rows: RequisiteSource[]): RequisiteSections {
  const taxIds: TaxIdDraft[] = [];
  const accounts: AccountDraft[] = [];
  const cards: CardDraft[] = [];
  const leftoverIds: string[] = [];

  for (const row of rows) {
    const taxId = filled(row.taxId);
    const accountNumber = filled(row.accountNumber);
    const cardNumber = filled(row.cardNumber);
    const bankName = filled(row.bankName);
    const bic = filled(row.bic);
    const parts = [
      taxId ? "tax" : null,
      accountNumber ? "account" : null,
      cardNumber ? "card" : null,
    ].filter(Boolean);

    if (parts.length === 0) {
      leftoverIds.push(row.id);
      continue;
    }

    let keptId = false;
    const takeId = () => {
      if (keptId) return { id: `${row.id}-split-${parts.length}`, isNew: true };
      keptId = true;
      return { id: row.id, isNew: false };
    };

    if (taxId) taxIds.push({ ...takeId(), taxId });
    if (accountNumber) {
      accounts.push({ ...takeId(), accountNumber, bankName, bic });
    }
    if (cardNumber) cards.push({ ...takeId(), cardNumber, bankName });
  }

  return { taxIds, accounts, cards, leftoverIds };
}

export function inferPaymentMethod(input: {
  cardNumber?: string | null;
  accountNumber?: string | null;
}): "card" | "bank_transfer" {
  return filled(input.cardNumber) ? "card" : "bank_transfer";
}

export function sectionsToRequisitePayloads(sections: {
  taxIds: Array<{ taxId: string }>;
  accounts: Array<{ accountNumber: string; bankName: string; bic: string }>;
  cards: Array<{ cardNumber: string; bankName: string }>;
}) {
  return [
    ...sections.taxIds
      .map((row) => ({
        paymentMethod: "bank_transfer" as const,
        taxId: filled(row.taxId) || null,
        bic: null,
        bankName: null,
        accountNumber: null,
        cardNumber: null,
      }))
      .filter((row) => row.taxId),
    ...sections.accounts
      .map((row) => ({
        paymentMethod: "bank_transfer" as const,
        taxId: null,
        bic: filled(row.bic) || null,
        bankName: filled(row.bankName) || null,
        accountNumber: filled(row.accountNumber) || null,
        cardNumber: null,
      }))
      .filter((row) => row.accountNumber || row.bankName || row.bic),
    ...sections.cards
      .map((row) => ({
        paymentMethod: inferPaymentMethod(row),
        taxId: null,
        bic: null,
        bankName: filled(row.bankName) || null,
        accountNumber: null,
        cardNumber: filled(row.cardNumber) || null,
      }))
      .filter((row) => row.cardNumber || row.bankName),
  ];
}
