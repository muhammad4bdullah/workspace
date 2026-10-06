(function(){
    "use strict";

    const FORMAT="AZPACE";
    const VERSION=1;
    const KINDS=new Set([
        "presentation",
        "spreadsheet",
        "document",
        "note",
        "notes-workspace"
    ]);
    const MIME="application/vnd.azpace.native+json";

    function isoNow(){
        return new Date().toISOString();
    }

    function normalizeMetadata(metadata={},kind){
        const now=isoNow();
        const createdAt=metadata.createdAt??now;
        const modifiedAt=metadata.modifiedAt??now;
        for(const [field,value] of [["createdAt",createdAt],["modifiedAt",modifiedAt]]){
            if(typeof value!=="string"||!Number.isFinite(Date.parse(value))){
                throw new Error(`Native file metadata has an invalid ${field} value.`);
            }
        }
        return {
            app:"A-Zpace",
            kind,
            title:String(metadata.title||"Untitled"),
            createdAt,
            modifiedAt,
            author:String(metadata.author||""),
            subject:String(metadata.subject||""),
            keywords:String(metadata.keywords||""),
            comments:String(metadata.comments||""),
            ...(metadata.custom&&typeof metadata.custom==="object"&&
                !Array.isArray(metadata.custom)
                ? {custom:metadata.custom}
                : {})
        };
    }

    function create(kind,data,metadata){
        if(!KINDS.has(kind)){
            throw new Error(`Unsupported A-Zpace file type: ${kind}`);
        }
        if(!data||typeof data!=="object"||Array.isArray(data)){
            throw new Error("Native file data must be an object.");
        }

        return {
            format:FORMAT,
            formatVersion:VERSION,
            kind,
            metadata:normalizeMetadata(metadata,kind),
            data
        };
    }

    function parse(text,expectedKind){
        let value;
        try{
            value=JSON.parse(text);
        }catch(error){
            throw new Error(`This is not a valid A-Zpace file: ${error.message}`);
        }

        if(!value||typeof value!=="object"||Array.isArray(value)){
            throw new Error("The A-Zpace file must contain a JSON object.");
        }
        if(value.format!==FORMAT){
            throw new Error("This file does not have the A-Zpace native format signature.");
        }
        if(value.formatVersion!==VERSION){
            throw new Error(`Unsupported A-Zpace file version: ${value.formatVersion}`);
        }
        if(!KINDS.has(value.kind)){
            throw new Error(`Unknown A-Zpace document type: ${value.kind}`);
        }
        if(expectedKind&&value.kind!==expectedKind){
            throw new Error(
                `This is an A-Zpace ${value.kind} file, not an A-Zpace ${expectedKind} file.`
            );
        }
        if(!value.metadata||typeof value.metadata!=="object"||Array.isArray(value.metadata)){
            throw new Error("The A-Zpace file is missing its metadata object.");
        }
        if(value.metadata.app!=="A-Zpace"||value.metadata.kind!==value.kind){
            throw new Error("The A-Zpace file metadata type does not match its contents.");
        }
        if(typeof value.metadata.title!=="string"||!value.metadata.title.trim()){
            throw new Error("The A-Zpace file is missing its document title.");
        }
        for(const field of ["createdAt","modifiedAt"]){
            if(
                typeof value.metadata[field]!=="string"||
                !Number.isFinite(Date.parse(value.metadata[field]))
            ){
                throw new Error(`The A-Zpace file has invalid ${field} metadata.`);
            }
        }
        if(!value.data||typeof value.data!=="object"||Array.isArray(value.data)){
            throw new Error("The A-Zpace file is missing its document data.");
        }

        return value;
    }

    function serialize(kind,data,metadata){
        return JSON.stringify(create(kind,data,metadata),null,2);
    }

    function download(kind,data,metadata,filename){
        const blob=new Blob(
            [serialize(kind,data,metadata)],
            {type:MIME}
        );
        const url=URL.createObjectURL(blob);
        const link=document.createElement("a");
        link.href=url;
        link.download=filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
    }

    window.AZpaceFiles=Object.freeze({
        format:FORMAT,
        version:VERSION,
        mime:MIME,
        create,
        parse,
        serialize,
        download
    });
})();
