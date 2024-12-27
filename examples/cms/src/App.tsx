import "./App.css"

import type { ManagedCollection } from "framer-plugin"

import { framer } from "framer-plugin"
import { useEffect, useLayoutEffect, useState } from "react"
import { DataSource, getDataSource } from "./data"
import { FieldMapping } from "./FieldMapping"
import { SelectDataSource } from "./SelectDataSource"
import { Spinner } from "./components/Spinner"

interface AppProps {
    collection: ManagedCollection
    previousDataSourceId: string | null
    previousSlugFieldId: string | null
}

export function App({ collection, previousDataSourceId, previousSlugFieldId }: AppProps) {
    const [dataSource, setDataSource] = useState<DataSource | null>(null)

    const [isLoadingDataSource, setIsLoadingDataSource] = useState(Boolean(previousDataSourceId))
    const hasDataSourceSelected = Boolean(isLoadingDataSource || dataSource)

    useLayoutEffect(() => {
        framer.showUI({
            width: hasDataSourceSelected ? 360 : 320,
            height: hasDataSourceSelected ? 425 : 305,
            minWidth: hasDataSourceSelected ? 360 : undefined,
            minHeight: hasDataSourceSelected ? 425 : undefined,
            resizable: dataSource !== null,
        })
    }, [hasDataSourceSelected, dataSource])

    useEffect(() => {
        if (!previousDataSourceId) {
            return
        }

        const abortController = new AbortController()

        setIsLoadingDataSource(true)
        getDataSource(previousDataSourceId, abortController.signal)
            .then(setDataSource)
            .catch(error => {
                if (abortController.signal.aborted) {
                    return
                }

                console.error(error)
                framer.notify(
                    `Error loading previously configured data source "${previousDataSourceId}". Check the logs for more details.`,
                    {
                        variant: "error",
                    }
                )
            })
            .finally(() => {
                if (abortController.signal.aborted) {
                    return
                }

                setIsLoadingDataSource(false)
            })

        return () => {
            abortController.abort()
        }
    }, [previousDataSourceId])

    if (isLoadingDataSource) {
        return <Spinner />
    }

    if (!dataSource) {
        return <SelectDataSource onSelectDataSource={setDataSource} />
    }

    return <FieldMapping collection={collection} dataSource={dataSource} initialSlugFieldId={previousSlugFieldId} />
}
