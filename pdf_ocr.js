const TESSERACT_MODULE =
    "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js";

export async function createOcrWorker(onProgress){
    const tesseract = await import(TESSERACT_MODULE);
    const worker = await tesseract.createWorker(
        "eng",
        1,
        {
            workerPath:
                "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js",
            corePath:
                "https://cdn.jsdelivr.net/npm/tesseract.js-core@5/",
            langPath:
                "https://tessdata.projectnaptha.com/4.0.0",
            logger:message => {
                if(onProgress)
                    onProgress(message);
            }
        }
    );

    return {
        async recognize(canvas){
            const result = await worker.recognize(canvas);
            return (result.data.words || [])
                .filter(word =>
                    typeof word.text === "string" &&
                    word.text.trim() &&
                    word.confidence >= 20
                )
                .map(word => ({
                    text:word.text.trim(),
                    confidence:word.confidence,
                    box:{
                        x0:word.bbox.x0,
                        y0:word.bbox.y0,
                        x1:word.bbox.x1,
                        y1:word.bbox.y1
                    }
                }));
        },
        terminate(){
            return worker.terminate();
        }
    };
}
