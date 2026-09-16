"use client";

import * as React from "react";
import { PageHeader } from "@/components/ui-custom/PageHeader";
import { usePersistedInterfaceState } from "@/components/PersistedInterfaceState";
import { BanksClient } from "../banks/BanksClient";

const TABS = [{ id: "banks", label: "Банки" }] as const;
type Tab = (typeof TABS)[number]["id"];

export function CatalogClient() {
  const [activeTab, setActiveTab] = React.useState<Tab>("banks");

  usePersistedInterfaceState("catalog", { activeTab }, (stored) => {
    if (stored.activeTab === "banks") setActiveTab(stored.activeTab);
  });

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader title="Справочник" />

      <div className="mb-4 border-b border-neutral-200">
        <nav className="flex gap-0 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-neutral-500 hover:border-neutral-300 hover:text-neutral-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === "banks" && <BanksClient />}
    </div>
  );
}
