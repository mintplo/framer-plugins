import { Fragment, useMemo, useState } from "react"
import { ManagedCollectionField } from "framer-plugin"
import { useInView } from "react-intersection-observer"
import cx from "classnames"
import { CellValue, CollectionFieldType, HeaderRow, PluginContext, Row, SyncMutationOptions } from "../sheets"

import { IconChevron } from "../components/Icons"
import { Button } from "../components/Button"
import { CheckboxTextfield } from "../components/CheckboxTextField"
import { generateUniqueNames } from "../utils"

interface FieldTypeOption {
    type: CollectionFieldType
    label: string
}

const fieldTypeOptions: FieldTypeOption[] = [
    { type: "boolean", label: "Boolean" },
    { type: "color", label: "Color" },
    { type: "number", label: "Number" },
    { type: "string", label: "String" },
    { type: "formattedText", label: "Formatted Text" },
    { type: "image", label: "Image" },
    { type: "link", label: "Link" },
    { type: "date", label: "Date" },
]

const getInitialSlugColumn = (context: PluginContext, slugFields: ManagedCollectionField[]): string => {
    if (context.type === "update" && context.slugColumn) {
        return context.slugColumn
    }

    return slugFields[0]?.id ?? ""
}

const getLastSyncedTime = (context: PluginContext, slugColumn: string): string | null => {
    if (context.type !== "update") return null

    // Always resync if the slug field changes
    if (context.slugColumn !== slugColumn) return null

    // Always resync if field config changes
    if (context.hasChangedFields) {
        return null
    }

    return context.lastSyncedTime
}

const inferFieldType = (cellValue: CellValue): CollectionFieldType => {
    if (typeof cellValue === "boolean") return "boolean"
    if (typeof cellValue === "number") return "number"

    if (typeof cellValue === "string") {
        const cellValueLowered = cellValue.trim().toLowerCase()

        // If the cell value contains a newline, it's probably a formatted text field
        if (cellValueLowered.includes("\n")) return "formattedText"
        const maybeDate = new Date(cellValueLowered)
        if (!Number.isNaN(maybeDate.getTime())) return "date"
        if (/^#[0-9a-f]{6}$/.test(cellValueLowered)) return "color"
        if (/<[a-z][\s\S]*>/.test(cellValueLowered)) return "formattedText"

        try {
            new URL(cellValueLowered)

            if (/\.(gif|jpe?g|png|apng|svg|webp)$/i.test(cellValueLowered)) return "image"

            return "link"
        } catch (e) {
            return "string"
        }
    }

    return "string"
}

const getFieldType = (context: PluginContext, columnId: string, cellValue?: CellValue): CollectionFieldType => {
    // Determine if the field type is already configured
    if ("collectionFields" in context) {
        const field = context.collectionFields?.find(field => field.id === columnId)
        return field?.type ?? "string"
    }

    // Otherwise, infer the field type from the cell value
    return cellValue ? inferFieldType(cellValue) : "string"
}

const createFieldConfig = (
    headerRow: HeaderRow,
    uniqueColumnNames: string[],
    context: PluginContext,
    row?: Row
): ManagedCollectionField[] => {
    return headerRow.map((_, columnIndex) => {
        const sanitizedName = uniqueColumnNames[columnIndex]

        return {
            id: sanitizedName,
            name: sanitizedName,
            type: getFieldType(context, sanitizedName, row?.[columnIndex]),
        } as ManagedCollectionField
    })
}

const getFieldNameOverrides = (context: PluginContext): Record<string, string> => {
    const result: Record<string, string> = {}
    if (context.type !== "update") return result

    for (const field of context.collectionFields) {
        result[field.id] = field.name
    }

    return result
}

const getPossibleSlugFields = (fieldConfig: ManagedCollectionField[]): ManagedCollectionField[] => {
    return fieldConfig.filter(field => field.type === "string")
}

interface Props {
    spreadsheetId: string
    sheetTitle: string
    headerRow: HeaderRow
    pluginContext: PluginContext
    onSubmit: (opts: SyncMutationOptions) => void
    isPending: boolean
    rows: Row[]
}

export function MapSheetFieldsPage({
    spreadsheetId,
    sheetTitle,
    headerRow,
    pluginContext,
    onSubmit,
    isPending,
    rows,
}: Props) {
    const { ref: scrollRef, inView: isAtBottom } = useInView({ threshold: 1 })

    const uniqueColumnNames = useMemo(() => generateUniqueNames(headerRow), [headerRow])
    const [fieldConfig, setFieldConfig] = useState<ManagedCollectionField[]>(() =>
        createFieldConfig(headerRow, uniqueColumnNames, pluginContext, rows[0])
    )
    const [disabledColumns, setDisabledColumns] = useState(
        () => new Set<string>(pluginContext.type === "update" ? pluginContext.ignoredColumns : [])
    )
    const slugFields = useMemo(
        () => getPossibleSlugFields(fieldConfig).filter(fieldConfig => !disabledColumns.has(fieldConfig.id)),
        [fieldConfig, disabledColumns]
    )
    const [slugColumn, setSlugColumn] = useState<string>(() => getInitialSlugColumn(pluginContext, slugFields))
    const [fieldNameOverrides, setFieldNameOverrides] = useState<Record<string, string>>(() =>
        getFieldNameOverrides(pluginContext)
    )

    const handleFieldToggle = (id: string) => {
        setDisabledColumns(current => {
            const nextSet = new Set(current)
            if (nextSet.has(id)) {
                nextSet.delete(id)

                // If we're re-enabling a string field and there's currently no valid slug column,
                // set this field as the slug column
                const field = fieldConfig.find(config => config.id === id)
                if (field?.type === "string") {
                    const currentSlugField = fieldConfig.find(config => config.id === slugColumn)
                    if (!currentSlugField || nextSet.has(slugColumn)) {
                        setSlugColumn(id)
                    }
                }
            } else {
                nextSet.add(id)

                // If the disabled column is the slug column, we need to update it to the next
                // possible slug field
                if (id === slugColumn) {
                    const nextSlugField = getPossibleSlugFields(fieldConfig).find(
                        field => field.id !== id && !nextSet.has(field.id)
                    )
                    if (nextSlugField) {
                        setSlugColumn(nextSlugField.id)
                    }
                }
            }
            return nextSet
        })
    }

    const handleFieldNameChange = (id: string, value: string) => {
        setFieldNameOverrides(current => ({
            ...current,
            [id]: value,
        }))
    }

    const handleFieldTypeChange = (id: string, type: CollectionFieldType) => {
        setFieldConfig(current =>
            current.map(field => {
                if (field.id === id) {
                    return {
                        ...field,
                        type,
                    } as ManagedCollectionField
                }
                return field
            })
        )
    }

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()

        if (isPending) return

        const allFields = fieldConfig
            .filter(field => !disabledColumns.has(field.id))
            .map(field => {
                if (fieldNameOverrides[field.id]) {
                    field.name = fieldNameOverrides[field.id]
                }

                return field
            })

        onSubmit({
            fields: allFields,
            spreadsheetId,
            sheetTitle,
            colFieldTypes: fieldConfig.map(field => field.type ?? "string"),
            ignoredColumns: Array.from(disabledColumns),
            slugColumn,
            lastSyncedTime: getLastSyncedTime(pluginContext, slugColumn),
        })
    }

    return (
        <form onSubmit={handleSubmit} className="col gap-[15px] flex-1 text-tertiary">
            <div className="h-px border-b border-divider sticky top-0" />
            <div className="flex flex-col gap-4 h-fit">
                <div className="flex flex-col gap-2 w-full">
                    <label htmlFor="collectionName">Slug Field</label>
                    <select
                        className="w-full"
                        value={slugColumn}
                        onChange={e => setSlugColumn(e.target.value)}
                        required
                    >
                        {slugFields.map(field => (
                            <option key={field.id} value={field.id}>
                                {field.name}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
            <div className="grid grid-cols items-center grid-cols-fieldPicker gap-2.5 mb-auto overflow-hidden mt-[10px]">
                <span className="col-span-2">Column</span>
                <span>Field</span>
                <span>Type</span>
                {fieldConfig.map((field, i) => {
                    const isDisabled = disabledColumns.has(field.id)

                    return (
                        <Fragment key={i}>
                            <CheckboxTextfield
                                value={field.name}
                                darken={isDisabled}
                                checked={!isDisabled}
                                onChange={() => handleFieldToggle(field.id)}
                            />
                            <div className="flex items-center justify-center">
                                <IconChevron />
                            </div>
                            <input
                                type="text"
                                className={cx("w-full", {
                                    "opacity-50": isDisabled,
                                })}
                                disabled={isDisabled}
                                placeholder={field.name}
                                value={fieldNameOverrides[field.id] ?? ""}
                                onChange={e => handleFieldNameChange(field.id, e.target.value)}
                            />
                            <select
                                className="w-full"
                                disabled={isDisabled}
                                value={field.type}
                                onChange={e => {
                                    handleFieldTypeChange(field.id, e.target.value as CollectionFieldType)
                                }}
                            >
                                {fieldTypeOptions.map(({ type, label }) => (
                                    <option key={type} value={type}>
                                        {label}
                                    </option>
                                ))}
                            </select>
                        </Fragment>
                    )
                })}
                {fieldConfig.length > 4 && !isAtBottom && <div className="scroll-fade"></div>}
                <div ref={scrollRef} className="h-0 w-0 bg-red-500 "></div>
            </div>
            <div className="sticky left-0 bottom-0 flex justify-between bg-primary py-4 border-t border-divider border-opacity-20 items-center max-w-full overflow-hidden">
                <Button variant="secondary" isLoading={isPending} className="w-full">
                    {`Import from ${sheetTitle}`}
                </Button>
            </div>
        </form>
    )
}
