/**
 * Человекочитаемые подписи полей и порядок отображения для таблицы
 * сравнения снимков (`SnapshotComparisonPanel`). Общий словарь для всех
 * моделей — конфликтов имён полей между моделями нет, поэтому подписи
 * можно не разделять по модели.
 */

export const FIELD_LABELS: Record<string, string> = {
  // Общие
  id: "ID",
  name: "Название",
  shortName: "Короткое имя",
  status: "Статус",
  comment: "Комментарий",
  createdAt: "Создано",
  updatedAt: "Изменено",
  note: "Заметка",

  // Номера сущностей
  issuedWorkNumber: "№ работы",
  issuedWorkNumberYear: "Год номера работы",
  issuedWorkNumberSerial: "Серийный № работы",
  payoutNumber: "№ выплаты",
  payoutNumberYear: "Год номера выплаты",
  payoutNumberSerial: "Серийный № выплаты",
  otherExpenseNumber: "№ прочей траты",
  otherExpenseNumberYear: "Год номера траты",
  otherExpenseNumberSerial: "Серийный № траты",

  // Связи (заменяются на названия, но подпись всё равно нужна как fallback)
  executorId: "Исполнитель",
  responsibleExecutorId: "Ответственный",
  responsibleUserId: "Ответственный (пользователь)",
  projectId: "Проект",
  workTypeId: "Вид работ",
  bankAccountId: "Банковский счёт",
  clientId: "Клиент",
  createdById: "Создал",
  userId: "Пользователь",
  orderId: "Заказ",
  paymentId: "Выплата",
  defaultBankAccountId: "Счёт по умолчанию",

  // Work / OtherExpense / Payment
  executionYear: "Год выполнения",
  executionMonth: "Месяц выполнения",
  periodYear: "Год периода",
  periodMonth: "Месяц периода",
  amount: "Сумма работы",
  paymentAmount: "Сумма выплаты",
  volume: "Объём",
  rate: "Ставка",
  plannedPayAt: "Дата оплаты план",
  paidAt: "Дата оплаты факт",
  checkedAt: "Дата проверки",
  workStatus: "Статус работы",
  paymentStatus: "Статус выплаты",
  preferredPayMethod: "Способ оплаты",
  description: "Описание",
  techTask: "ТЗ",
  report: "Отчёт",
  link: "Ссылка",
  filledTechTask: "Заполненное ТЗ",
  filledAct: "Заполненный акт",
  sourceUid: "Источник (UID)",

  // Executor
  type: "Тип",
  companyStatus: "Статус в компании",
  legalForm: "Тип юрлица",
  recipientType: "Тип получателя",
  specialty: "Специализация",
  specialties: "Специализации",
  contractFile: "Договор",
  ndaFile: "NDA",
  inTgChat: "В Tg-чате",
  contacts: "Контакт (общее)",
  contactEmail: "Контакт email",
  accessEmail: "Email для доступа",
  requisites: "Реквизиты",
  isResponsible: "Является ответственным",
  responsibleActive: "Активен как ответственный",
  oldEstimateUrl: "Старая смета (URL)",
  accessRevokedAt: "Доступ отозван",
  onboardingSeeded: "Онбординг создан",

  // Project / Client
  company: "Компания",
  department: "Департамент",
  responsibleUser: "Ответственный",
  cashflowInitial: "Начальный кэшфлоу",

  // BankAccount / Currency / WorkType
  details: "Реквизиты",
  currency: "Валюта",
  isDefault: "По умолчанию",
  segment: "Сегмент",

  // Прочее
  fullName: "ФИО",
  email: "Email",
  role: "Роль",
  isSuperAdmin: "Суперадмин",
  isActive: "Активен",
};

/** Порядок предпочтительных полей — номер и ключевые атрибуты сначала. */
export const PREFERRED_FIELD_ORDER = [
  "issuedWorkNumber",
  "payoutNumber",
  "otherExpenseNumber",
  "name",
  "fullName",
  "title",
  "description",
  "executorId",
  "projectId",
  "workTypeId",
  "bankAccountId",
  "clientId",
  "responsibleExecutorId",
  "responsibleUserId",
  "amount",
  "paymentAmount",
  "workStatus",
  "paymentStatus",
  "status",
];

/** Поля, которые всегда скрываются из таблицы сравнения. */
export const HIDDEN_FIELDS = new Set([
  "id",
  "password",
  "updatedAt",
  "createdById",
  "userId",
  "issuedWorkNumberYear",
  "issuedWorkNumberSerial",
  "payoutNumberYear",
  "payoutNumberSerial",
  "otherExpenseNumberYear",
  "otherExpenseNumberSerial",
]);

/** Поля дат (форматируются как дд.мм.гггг). */
export const DATE_FIELDS = new Set([
  "plannedPayAt",
  "paidAt",
  "checkedAt",
  "createdAt",
  "updatedAt",
  "accessRevokedAt",
]);

/** Поля денежных сумм (форматируются как «1 234 567»). */
export const MONEY_FIELDS = new Set(["amount", "paymentAmount", "cashflowInitial"]);

/** Поля-связи → какая справочная карта (id → имя) используется. */
export const RELATION_FIELD_MAP: Record<string, "executor" | "project" | "workType" | "bankAccount" | "client" | "user" | "order"> = {
  executorId: "executor",
  responsibleExecutorId: "executor",
  defaultBankAccountId: "bankAccount",
  projectId: "project",
  workTypeId: "workType",
  bankAccountId: "bankAccount",
  clientId: "client",
  responsibleUserId: "user",
  createdById: "user",
  userId: "user",
  orderId: "order",
};

/** Переопределения подписи для конкретных моделей (когда общий словарь неверен). */
const MODEL_FIELD_LABEL_OVERRIDES: Record<string, Record<string, string>> = {
  // У Payment нет отдельной «суммы работы» — amount это и есть сумма выплаты.
  Payment: { amount: "Сумма выплаты" },
};

export function fieldLabel(field: string, model?: string): string {
  if (model && MODEL_FIELD_LABEL_OVERRIDES[model]?.[field]) {
    return MODEL_FIELD_LABEL_OVERRIDES[model][field];
  }
  return FIELD_LABELS[field] ?? field;
}

/** Русские названия моделей snapshot для селектора в таблице сравнения. */
export const MODEL_LABELS: Record<string, string> = {
  User: "Пользователи",
  Executor: "Исполнители",
  Client: "Клиенты",
  Project: "Проекты",
  ProjectWorkType: "Виды работ проекта",
  ProjectExecutor: "Исполнители проекта",
  BankAccount: "Банковские счета",
  Currency: "Валюты",
  WorkType: "Виды работ",
  ExecutorWorkType: "Виды работ исполнителя",
  Work: "Выставленные работы",
  Payment: "Выплаты",
  OtherExpense: "Прочие траты",
  NumberCounter: "Счётчики номеров",
  Order: "Заказы",
  Charge: "Начисления",
  BankOperation: "Банковские операции",
  SpendingPlanLine: "Строки плана расходов",
  VacationEntry: "Отпуска",
  Task: "Задачи",
  CashflowOpeningBalance: "Начальный остаток кэшфлоу",
  CashflowCellComment: "Комментарии к кэшфлоу",
  ActivityLog: "История действий",
  BankAccountReconciliation: "Сверки счетов",
  BankAccountReconciliationResult: "Результаты сверки счетов",
  ProjectVerification: "Проверки проектов",
  ProjectVerificationResult: "Результаты проверки проектов",
};

export function modelLabel(model: string): string {
  return MODEL_LABELS[model] ?? model;
}
