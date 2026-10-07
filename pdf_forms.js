function fieldKind(field){
    const name = field.constructor.name;
    if(name.includes("TextField")) return "text";
    if(name.includes("CheckBox")) return "checkbox";
    if(name.includes("RadioGroup")) return "radio";
    if(name.includes("Dropdown") || name.includes("OptionList"))
        return "choice";
    if(name.includes("Button")) return "button";
    if(name.includes("Signature")) return "signature";
    return "unsupported";
}

export function listFormFields(document){
    const form = document.getForm();
    return form.getFields().map(field => {
        const kind = fieldKind(field);
        let value = "";
        let options = [];

        if(kind === "text")
            value = field.getText() || "";
        else if(kind === "checkbox")
            value = field.isChecked();
        else if(kind === "radio"){
            value = field.getSelected() || "";
            options = field.getOptions();
        }else if(kind === "choice"){
            value = field.getSelected() || [];
            options = field.getOptions();
        }

        return {
            name:field.getName(),
            kind,
            value,
            options,
            multiple:field.constructor.name.includes("OptionList"),
            editable:["text","checkbox","radio","choice"].includes(kind)
        };
    });
}

export function applyFormValues(document,values,flatten){
    const form = document.getForm();
    const unsupported = [];

    for(const [name,value] of Object.entries(values)){
        const field = form.getField(name);
        const kind = fieldKind(field);

        if(kind === "text"){
            field.setText(String(value));
        }else if(kind === "checkbox"){
            if(value)
                field.check();
            else
                field.uncheck();
        }else if(kind === "radio"){
            if(value)
                field.select(String(value));
        }else if(kind === "choice"){
            const selections = Array.isArray(value)
                ? value
                : value
                    ? [String(value)]
                    : [];
            if(selections.length)
                field.select(selections);
        }else{
            unsupported.push(name);
        }
    }

    if(flatten)
        form.flatten();

    return unsupported;
}

export function setFormValues(document,values){
    return applyFormValues(document,values,false);
}

export function flattenForm(document){
    const form = document.getForm();
    form.updateFieldAppearances();
    form.flatten();
}

export function createFormField(document,spec){
    const form = document.getForm();
    let field;

    if(spec.kind === "text"){
        field = form.createTextField(spec.name);
    }else if(spec.kind === "checkbox"){
        field = form.createCheckBox(spec.name);
    }else if(spec.kind === "dropdown"){
        field = form.createDropdown(spec.name);
        field.addOptions(spec.options);
    }else if(spec.kind === "radio"){
        field = form.createRadioGroup(spec.name);
        field.addOptions(spec.options);
    }else{
        throw new Error(`Unsupported form field type: ${spec.kind}`);
    }

    field.addToPage(
        document.getPage(spec.pageIndex),
        {
            x:spec.x,
            y:spec.y,
            width:spec.width,
            height:spec.height,
            borderWidth:1
        }
    );

    return field;
}
