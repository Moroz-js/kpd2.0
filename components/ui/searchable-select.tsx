"use client"

import * as React from "react"
import { Combobox } from "@base-ui/react/combobox"
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { matchesSearchText } from "@/lib/search"

export type SearchableSelectOption = {
  value: string
  label: string
  searchText?: string
  disabled?: boolean
}

export type SearchableSelectProps = {
  value: string
  onValueChange: (value: string) => void
  options: SearchableSelectOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  disabled?: boolean
  id?: string
  name?: string
  required?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  triggerClassName?: string
  contentClassName?: string
  optionClassName?: string
  renderOption?: (option: SearchableSelectOption) => React.ReactNode
  renderValue?: (option: SearchableSelectOption) => React.ReactNode
}

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = "Выберите...",
  searchPlaceholder = "Поиск...",
  emptyMessage = "Ничего не найдено",
  disabled = false,
  id,
  name,
  required,
  open,
  onOpenChange,
  triggerClassName,
  contentClassName,
  optionClassName,
  renderOption,
  renderValue,
}: SearchableSelectProps) {
  const [internalOpen, setInternalOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)
  const isOpen = open ?? internalOpen
  const selectedOption = options.find((option) => option.value === value) ?? null

  function handleOpenChange(nextOpen: boolean) {
    if (open === undefined) setInternalOpen(nextOpen)
    if (!nextOpen) setQuery("")
    onOpenChange?.(nextOpen)
  }

  return (
    <Combobox.Root<SearchableSelectOption>
      value={selectedOption}
      onValueChange={(option) => onValueChange(option?.value ?? "")}
      items={options}
      inputValue={query}
      onInputValueChange={setQuery}
      filter={(option, inputValue) => {
        return matchesSearchText(inputValue, option.label, option.searchText)
      }}
      itemToStringLabel={(option) => option.label}
      itemToStringValue={(option) => option.value}
      isItemEqualToValue={(option, selected) => option.value === selected.value}
      open={isOpen}
      onOpenChange={handleOpenChange}
      disabled={disabled}
      name={name}
      required={required}
      autoHighlight
    >
      <Combobox.Trigger
        id={id}
        disabled={disabled}
        data-slot="searchable-select-trigger"
        className={cn(
          "flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-background py-2 pr-2 pl-2.5 text-sm text-foreground whitespace-nowrap transition-colors outline-none select-none hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-placeholder:text-muted-foreground dark:bg-input/30 dark:hover:bg-input/50",
          triggerClassName
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate text-left", !selectedOption && "text-muted-foreground")}>
          {selectedOption
            ? (renderValue?.(selectedOption) ?? selectedOption.label)
            : placeholder}
        </span>
        <Combobox.Icon
          render={<ChevronDownIcon className="pointer-events-none size-4 shrink-0 text-muted-foreground" />}
        />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner
          side="bottom"
          sideOffset={4}
          align="start"
          className="isolate z-50"
        >
          <Combobox.Popup
            initialFocus={inputRef}
            data-slot="searchable-select-content"
            className={cn(
              "relative isolate z-50 max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
              contentClassName
            )}
          >
            <div className="flex items-center border-b px-2">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
              <Combobox.Input
                ref={inputRef}
                aria-label={searchPlaceholder}
                placeholder={searchPlaceholder}
                className="h-9 w-full bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <Combobox.Empty className="px-3 py-4 text-center text-xs text-muted-foreground">
              {emptyMessage}
            </Combobox.Empty>
            <Combobox.List className="max-h-72 overflow-y-auto p-1">
              {(option: SearchableSelectOption) => (
                <Combobox.Item
                  key={option.value}
                  value={option}
                  disabled={option.disabled}
                  className={cn(
                    "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
                    optionClassName
                  )}
                >
                  <span className="min-w-0 flex-1">
                    {renderOption?.(option) ?? option.label}
                  </span>
                  <Combobox.ItemIndicator className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
                    <CheckIcon className="size-4" />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
