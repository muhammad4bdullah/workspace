(function(){
    const databaseName = "dw-workspace-files";
    const storeName = "pending";

    function openDatabase(userId){
        return new Promise((resolve,reject) => {
            const request = indexedDB.open(
                `${databaseName}:${userId}`,
                1
            );
            request.onupgradeneeded = () => {
                if(!request.result.objectStoreNames.contains(storeName))
                    request.result.createObjectStore(storeName);
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function consumePendingFile(){
        const requestedName = new URLSearchParams(
            window.location.search
        ).get("open");
        if(!requestedName)
            return null;

        const userId = window.AZpaceAuth?.user?.id;
        if(!userId)
            throw new Error(
                "Sign in again before opening the file sent from your workspace."
            );

        const database = await openDatabase(userId);
        try{
            return await new Promise((resolve,reject) => {
                const transaction = database.transaction(
                    storeName,
                    "readwrite"
                );
                const store = transaction.objectStore(storeName);
                const request = store.get("current");
                let file = null;

                request.onsuccess = () => {
                    const pending = request.result;
                    if(!pending)
                        return;
                    if(pending.name !== requestedName){
                        reject(new Error(
                            "The file waiting to open does not match this page. Return to your workspace and open it again."
                        ));
                        transaction.abort();
                        return;
                    }
                    if(!(pending.blob instanceof Blob)){
                        reject(new Error(
                            "The file waiting to open is unavailable or damaged."
                        ));
                        transaction.abort();
                        return;
                    }
                    file = new File(
                        [pending.blob],
                        pending.name,
                        {
                            type:pending.type || pending.blob.type,
                            lastModified:pending.blob.lastModified || Date.now()
                        }
                    );
                    store.delete("current");
                };
                transaction.oncomplete = () => resolve(file);
                transaction.onerror = () => reject(transaction.error);
                transaction.onabort = () => {
                    if(!file)
                        reject(transaction.error || new Error(
                            "The pending file could not be opened."
                        ));
                };
            });
        }finally{
            database.close();
        }
    }

    window.AZpaceFileHandoff = {consumePendingFile};
})();
