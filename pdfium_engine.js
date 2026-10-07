const PDFIUM_MODULE_URL = "./vendor/pdfium/index.browser.js";
const PDFIUM_WASM_URL = "./vendor/pdfium/pdfium.wasm";

let modulePromise;

async function getPdfium(){
    if(!modulePromise){
        modulePromise = (async () => {
            const response = await fetch(PDFIUM_WASM_URL);
            if(!response.ok)
                throw new Error(
                    `Unable to load local PDFium WASM (${response.status}).`
                );
            const wasmBinary = await response.arrayBuffer();
            const {init} = await import(PDFIUM_MODULE_URL);
            const pdfium = await init({wasmBinary});
            pdfium.FPDF_InitLibrary();
            pdfium.PDFiumExt_Init();
            return pdfium;
        })().catch(error => {
            modulePromise = null;
            throw error;
        });
    }

    return modulePromise;
}

function readTextCharacters(pdfium,textPage){
    const count = pdfium.FPDFText_CountChars(textPage);
    const characters = [];
    const origin = pdfium.pdfium.wasmExports.malloc(8);

    try{
        for(let index=0; index<count; index++){
            const codePoint = pdfium.FPDFText_GetUnicode(
                textPage,
                index
            );
            const object = pdfium.FPDFText_GetTextObject(
                textPage,
                index
            );
            let x = null;
            let y = null;
            if(pdfium.FPDFText_GetCharOrigin(
                textPage,
                index,
                origin,
                origin + 4
            )){
                x = pdfium.pdfium.getValue(origin,"float");
                y = pdfium.pdfium.getValue(origin + 4,"float");
            }

            characters.push({
                text:codePoint ? String.fromCodePoint(codePoint) : "",
                object,
                x,
                y
            });
        }
    }finally{
        pdfium.pdfium.wasmExports.free(origin);
    }

    return characters;
}

function findTextRun(pdfium,textPage,edit){
    const wanted = Array.from(edit.originalText);
    if(!wanted.length)
        throw new Error("The selected PDF text is empty.");

    const characters = readTextCharacters(pdfium,textPage);
    const matches = [];
    for(let start=0; start<=characters.length-wanted.length; start++){
        let matchesText = true;
        for(let offset=0; offset<wanted.length; offset++){
            if(characters[start + offset].text !== wanted[offset]){
                matchesText = false;
                break;
            }
        }
        if(matchesText)
            matches.push(start);
    }

    if(!matches.length)
        throw new Error(
            `PDFium could not locate the selected text "${edit.originalText}" in the original content.`
        );

    let selected = matches[0];
    if(matches.length > 1 && Number.isFinite(edit.x) &&
        Number.isFinite(edit.y)){
        const positioned = matches.filter(start => {
            const character = characters[start];
            return Number.isFinite(character.x) &&
                Number.isFinite(character.y) &&
                Math.hypot(character.x - edit.x,character.y - edit.y) <= 4;
        });
        if(positioned.length === 1)
            selected = positioned[0];
        else
            throw new Error(
                `The selected text "${edit.originalText}" appears more than once and PDFium could not uniquely identify its position.`
            );
    }else if(matches.length > 1){
        throw new Error(
            `The selected text "${edit.originalText}" appears more than once; PDFium needs its exact position to avoid changing the wrong occurrence.`
        );
    }

    const object = characters[selected].object;
    if(!object || characters
        .slice(selected,selected + wanted.length)
        .some(character => character.object !== object)){
        throw new Error(
            "This text spans multiple PDF text objects and cannot be safely replaced as one run."
        );
    }

    const fullObjectText = characters
        .filter(character => character.object === object)
        .map(character => character.text)
        .join("");
    if(fullObjectText !== edit.originalText){
        throw new Error(
            "This selection is only part of a PDF text object. Editing the full object is unsafe, so the export was stopped without changing it."
        );
    }

    return object;
}

function saveDocument(pdfium,document){
    const writer = pdfium.PDFiumExt_OpenFileWriter();
    if(!writer)
        throw new Error("PDFium could not create a PDF output writer.");

    try{
        if(!pdfium.PDFiumExt_SaveAsCopy(document,writer))
            throw new Error(
                `PDFium failed to write the edited PDF (error ${pdfium.FPDF_GetLastError()}).`
            );

        const size = pdfium.PDFiumExt_GetFileWriterSize(writer);
        if(!size)
            throw new Error("PDFium returned an empty PDF.");
        const output = pdfium.pdfium.wasmExports.malloc(size);
        if(!output)
            throw new Error("PDFium could not allocate output memory.");

        try{
            const copied = pdfium.PDFiumExt_GetFileWriterData(
                writer,
                output,
                size
            );
            if(copied !== size)
                throw new Error(
                    `PDFium returned an incomplete PDF (${copied} of ${size} bytes).`
                );
            return pdfium.pdfium.HEAPU8.slice(
                output,
                output + size
            );
        }finally{
            pdfium.pdfium.wasmExports.free(output);
        }
    }finally{
        pdfium.PDFiumExt_CloseFileWriter(writer);
    }
}

export async function replaceTextObjects(bytes,edits){
    if(!edits.length)
        return bytes;

    const pdfium = await getPdfium();
    const input = bytes instanceof Uint8Array
        ? bytes
        : new Uint8Array(bytes);
    const inputPointer = pdfium.pdfium.wasmExports.malloc(input.length);
    if(!inputPointer)
        throw new Error("PDFium could not allocate input memory.");

    let document = 0;
    try{
        pdfium.pdfium.HEAPU8.set(input,inputPointer);
        document = pdfium.FPDF_LoadMemDocument(
            inputPointer,
            input.length,
            ""
        );
        if(!document)
            throw new Error(
                `PDFium could not open the PDF for text editing (error ${pdfium.FPDF_GetLastError()}).`
            );

        const editsByPage = new Map();
        for(const edit of edits){
            if(!Number.isInteger(edit.pageIndex) ||
                edit.pageIndex < 0 ||
                edit.pageIndex >= pdfium.FPDF_GetPageCount(document)){
                throw new Error(
                    `The selected text refers to an invalid PDF page (${edit.pageIndex + 1}).`
                );
            }
            if(!editsByPage.has(edit.pageIndex))
                editsByPage.set(edit.pageIndex,[]);
            editsByPage.get(edit.pageIndex).push(edit);
        }

        for(const [pageIndex,pageEdits] of editsByPage){
            const page = pdfium.FPDF_LoadPage(
                document,
                pageIndex
            );
            if(!page)
                throw new Error(
                    `PDFium could not open page ${pageIndex + 1} for text editing.`
                );

            const textPage = pdfium.FPDFText_LoadPage(page);
            if(!textPage){
                pdfium.FPDF_ClosePage(page);
                throw new Error(
                    `PDFium could not read text on page ${pageIndex + 1}.`
                );
            }

            try{
                for(const edit of pageEdits){
                    const object = findTextRun(
                        pdfium,
                        textPage,
                        edit
                    );
                    if(edit.text){
                        const bytesNeeded =
                        (edit.text.length + 1) * 2;
                        const replacement = pdfium.pdfium
                            .wasmExports.malloc(bytesNeeded);
                        if(!replacement)
                            throw new Error(
                                "PDFium could not allocate replacement text."
                            );
                        try{
                            pdfium.pdfium.stringToUTF16(
                                edit.text,
                                replacement,
                                bytesNeeded
                            );
                            if(!pdfium.FPDFText_SetText(
                                object,
                                replacement
                            )){
                                throw new Error(
                                    `PDFium could not replace "${edit.originalText}". The original PDF text was left unchanged.`
                                );
                            }
                        }finally{
                            pdfium.pdfium.wasmExports.free(replacement);
                        }
                    }else{
                        if(!pdfium.FPDFPage_RemoveObject(page,object))
                            throw new Error(
                                `PDFium could not delete "${edit.originalText}".`
                            );
                        pdfium.FPDFPageObj_Destroy(object);
                    }
                }

                if(!pdfium.FPDFPage_GenerateContent(page))
                    throw new Error(
                        `PDFium could not regenerate page ${pageIndex + 1} content.`
                    );
            }finally{
                pdfium.FPDFText_ClosePage(textPage);
                pdfium.FPDF_ClosePage(page);
            }
        }

        return saveDocument(pdfium,document);
    }finally{
        if(document)
            pdfium.FPDF_CloseDocument(document);
        pdfium.pdfium.wasmExports.free(inputPointer);
    }
}

export async function protectPdf(bytes,userPassword,ownerPassword,permissions){
    if(!userPassword || !ownerPassword)
        throw new Error(
            "Both a user password and an owner password are required."
        );

    const pdfium = await getPdfium();
    const input = bytes instanceof Uint8Array
        ? bytes
        : new Uint8Array(bytes);
    const inputPointer = pdfium.pdfium.wasmExports.malloc(input.length);
    if(!inputPointer)
        throw new Error("PDFium could not allocate input memory.");

    let document = 0;
    try{
        pdfium.pdfium.HEAPU8.set(input,inputPointer);
        document = pdfium.FPDF_LoadMemDocument(
            inputPointer,
            input.length,
            ""
        );
        if(!document)
            throw new Error(
                `PDFium could not open the PDF for password protection (error ${pdfium.FPDF_GetLastError()}).`
            );

        if(!pdfium.EPDF_SetEncryption(
            document,
            userPassword,
            ownerPassword,
            permissions
        )){
            throw new Error("PDFium failed to encrypt the document.");
        }

        return saveDocument(pdfium,document);
    }finally{
        if(document)
            pdfium.FPDF_CloseDocument(document);
        pdfium.pdfium.wasmExports.free(inputPointer);
    }
}
