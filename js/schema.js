// Schema Processor - Shows all fields by default
class SchemaProcessor {
    
    createModelSchema() {
        return {
            "type": "object",
            "title": "Model Information",
            "properties": {
                "Name": {
                    "type": "string",
                    "title": "Model Name",
                    "description": "Enter the name or title of your model",
                    "default": ""
                },
                "Author": {
                    "type": "array",
                    "title": "Author(s)",
                    "description": "List of authors or contributors",
                    "default": [{"Name": "", "Email": ""}],
                    "items": {
                        "type": "object",
                        "title": "Author",
                        "properties": {
                            "Name": {
                                "type": "string",
                                "title": "Name",
                                "description": "Full name of the author",
                                "default": ""
                            },
                            "Email": {
                                "type": "string",
                                "title": "Email",
                                "format": "email",
                                "description": "Email address",
                                "default": ""
                            },
                            "ORCID": {
                                "type": "string",
                                "title": "ORCID",
                                "description": "ORCID identifier (optional)",
                                "default": ""
                            },
                            "Address": {
                                "type": "string",
                                "title": "Address",
                                "description": "Physical address (optional)",
                                "default": ""
                            }
                        }
                    }
                },
                "Organization": {
                    "type": "array",
                    "title": "Organization(s)",
                    "description": "Developing or sponsoring organizations",
                    "default": [{"Name": ""}],
                    "items": {
                        "type": "object",
                        "title": "Organization",
                        "properties": {
                            "Name": {
                                "type": "string",
                                "title": "Organization Name",
                                "default": ""
                            },
                            "Contact name": {
                                "type": "string",
                                "title": "Contact Name",
                                "default": ""
                            },
                            "Email": {
                                "type": "string",
                                "title": "Email",
                                "format": "email",
                                "default": ""
                            },
                            "Address": {
                                "type": "string",
                                "title": "Address",
                                "default": ""
                            },
                            "URL": {
                                "type": "string",
                                "title": "Website URL",
                                "format": "uri",
                                "default": ""
                            }
                        }
                    }
                },
                "Date": {
                    "type": "object",
                    "title": "Important Dates",
                    "description": "Key dates for this model",
                    "properties": {
                        "Created": {
                            "type": "string",
                            "title": "Created",
                            "format": "date",
                            "description": "When the model was created (YYYY-MM-DD)"
                        },
                        "Published": {
                            "type": "string",
                            "title": "Published", 
                            "format": "date",
                            "description": "When the model was published (YYYY-MM-DD)"
                        },
                        "Updated": {
                            "type": "string",
                            "title": "Updated",
                            "format": "date",
                            "description": "When the model was last updated (YYYY-MM-DD)"
                        }
                    }
                },
                "Version": {
                    "type": "string",
                    "title": "Version",
                    "description": "Version number or identifier (e.g., v1.0, 2024-01)",
                    "default": ""
                },
                "Repository": {
                    "type": "array",
                    "title": "Code Repository URLs",
                    "description": "Links to code repositories",
                    "items": {
                        "type": "string",
                        "format": "uri",
                        "title": "Repository URL"
                    }
                },
                "Reference": {
                    "type": "array",
                    "title": "References",
                    "description": "Literature references or citations",
                    "items": {
                        "type": "object",
                        "title": "Reference",
                        "properties": {
                            "Authors": {
                                "type": "string",
                                "title": "Authors",
                                "description": "e.g., 'Smith J, et al.'",
                                "default": ""
                            },
                            "Title": {
                                "type": "string",
                                "title": "Title",
                                "description": "Title of the paper",
                                "default": ""
                            },
                            "Source": {
                                "type": "string",
                                "title": "Journal/Source",
                                "description": "Publication venue",
                                "default": ""
                            },
                            "Year": {
                                "type": "integer",
                                "title": "Year",
                                "description": "Publication year"
                            },
                            "DOI": {
                                "type": "string",
                                "title": "DOI",
                                "description": "Digital Object Identifier",
                                "default": ""
                            },
                            "URL": {
                                "type": "string",
                                "title": "URL",
                                "format": "uri",
                                "description": "Link to the paper",
                                "default": ""
                            }
                        }
                    }
                },
                "License": {
                    "type": "object",
                    "title": "License Information",
                    "description": "License terms for using this model",
                    "properties": {
                        "Text": {
                            "type": "string",
                            "title": "License",
                            "description": "e.g., MIT, Apache 2.0, Custom",
                            "default": ""
                        },
                        "URL": {
                            "type": "string",
                            "title": "License URL",
                            "format": "uri",
                            "description": "Link to license text (optional)",
                            "default": ""
                        }
                    }
                },
                "Contact": {
                    "type": "string",
                    "title": "Contact Email",
                    "format": "email",
                    "description": "Main contact for this model",
                    "default": ""
                },
                "Funding": {
                    "type": "string",
                    "title": "Funding Information",
                    "description": "Grants, sponsors, or funding sources",
                    "default": ""
                },
                "Comments": {
                    "type": "string",
                    "title": "Additional Comments",
                    "format": "textarea",
                    "description": "Any additional notes about this model",
                    "default": ""
                },
                "Input": {
                    "type": "string",
                    "title": "Model Input",
                    "format": "textarea",
                    "description": "Describe what data the model takes as input",
                    "default": ""
                },
                "Output": {
                    "type": "string", 
                    "title": "Model Output",
                    "format": "textarea",
                    "description": "Describe what the model outputs/predicts",
                    "default": ""
                },
                "Use": {
                    "type": "object",
                    "title": "Model Use Cases",
                    "properties": {
                        "Intended": {
                            "type": "array",
                            "title": "Intended Uses",
                            "description": "What this model is designed for",
                            "format": "checkbox",
                            "uniqueItems": true,
                            "items": {
                                "type": "string",
                                "enum": [
                                    "Detection",
                                    "Diagnosis", 
                                    "Prognosis",
                                    "Risk assessment",
                                    "Decision support",
                                    "Image processing",
                                    "Image segmentation",
                                    "Image reconstruction",
                                    "Report generation",
                                    "Screening",
                                    "Monitoring",
                                    "Treatment planning",
                                    "Quality assurance",
                                    "Research",
                                    "Other"
                                ]
                            }
                        },
                        "Out-of-scope": {
                            "type": "array",
                            "title": "Out-of-scope Uses",
                            "description": "Uses that are not recommended",
                            "items": {
                                "type": "string"
                            }
                        },
                        "Excluded": {
                            "type": "array",
                            "title": "Explicitly Excluded Uses",
                            "description": "Uses that are forbidden",
                            "items": {
                                "type": "string"
                            }
                        }
                    }
                },
                "User": {
                    "type": "object",
                    "title": "Intended Users",
                    "properties": {
                        "Intended": {
                            "type": "array",
                            "title": "Intended Users",
                            "description": "Who should use this model",
                            "format": "checkbox",
                            "uniqueItems": true,
                            "items": {
                                "type": "string",
                                "enum": [
                                    "Radiologist",
                                    "Diagnostic radiologist",
                                    "Interventional radiologist",
                                    "Subspecialist diagnostic radiologist",
                                    "Physician",
                                    "Referring physician",
                                    "Advanced practice provider",
                                    "Nurse practitioner",
                                    "Physician assistant",
                                    "Radiology technologist",
                                    "Researcher",
                                    "Data scientist",
                                    "Other healthcare provider"
                                ]
                            }
                        }
                    }
                },
                "Results": {
                    "type": "array",
                    "title": "Performance Results",
                    "description": "Model performance metrics and results",
                    "items": {
                        "type": "object",
                        "title": "Performance Result",
                        "properties": {
                            "Result Information": {
                                "type": "string",
                                "title": "Description",
                                "description": "What this result shows",
                                "default": ""
                            },
                            "Metric": {
                                "type": "array",
                                "title": "Metrics Used",
                                "items": {
                                    "type": "string",
                                    "enum": [
                                        "Accuracy",
                                        "Sensitivity", 
                                        "Specificity",
                                        "Precision",
                                        "Recall",
                                        "F1 score",
                                        "AUC-ROC",
                                        "AUC-PR",
                                        "Dice similarity coefficient",
                                        "Intersection over Union",
                                        "Mean absolute error",
                                        "Root mean square error",
                                        "Other"
                                    ]
                                }
                            },
                            "Value": {
                                "type": "string",
                                "title": "Result Value",
                                "description": "The measured value (e.g., '0.95', '87.2%')",
                                "default": ""
                            },
                            "Decision Threshold": {
                                "type": "string",
                                "title": "Decision Threshold",
                                "description": "Threshold used (if applicable)",
                                "default": ""
                            },
                            "Subset": {
                                "type": "string",
                                "title": "Test Data",
                                "description": "What data was used for this result",
                                "default": ""
                            }
                        }
                    }
                },
                "Limitations": {
                    "type": "string",
                    "title": "Model Limitations",
                    "format": "textarea",
                    "description": "Known limitations or constraints of the model",
                    "default": ""
                },
                "Ethical review": {
                    "type": "string",
                    "title": "Ethical Review",
                    "description": "IRB approval or ethical considerations",
                    "default": ""
                }
            },
            "required": ["Name"]
        };
    }

    createDatasetSchema() {
        return {
            "type": "object",
            "title": "Dataset Information",
            "properties": {
                "Name": {
                    "type": "string",
                    "title": "Dataset Name",
                    "description": "Enter the name of your dataset",
                    "default": ""
                },
                "Author": {
                    "type": "array",
                    "title": "Author(s)",
                    "description": "List of dataset creators",
                    "default": [{"Name": "", "Email": ""}],
                    "items": {
                        "type": "object",
                        "title": "Author",
                        "properties": {
                            "Name": {
                                "type": "string",
                                "title": "Name",
                                "default": ""
                            },
                            "Email": {
                                "type": "string",
                                "title": "Email",
                                "format": "email",
                                "default": ""
                            },
                            "ORCID": {
                                "type": "string",
                                "title": "ORCID",
                                "default": ""
                            }
                        }
                    }
                },
                "Organization": {
                    "type": "array",
                    "title": "Organization(s)",
                    "description": "Organizations that created or sponsor this dataset",
                    "default": [{"Name": ""}],
                    "items": {
                        "type": "object",
                        "properties": {
                            "Name": {
                                "type": "string",
                                "title": "Organization Name",
                                "default": ""
                            },
                            "Contact name": {
                                "type": "string",
                                "title": "Contact Name",
                                "default": ""
                            },
                            "Email": {
                                "type": "string",
                                "title": "Email",
                                "format": "email",
                                "default": ""
                            }
                        }
                    }
                },
                "Date": {
                    "type": "object",
                    "title": "Important Dates",
                    "properties": {
                        "Created": {
                            "type": "string",
                            "title": "Created",
                            "format": "date",
                            "description": "When dataset was created"
                        },
                        "Published": {
                            "type": "string",
                            "title": "Published",
                            "format": "date",
                            "description": "When dataset was published" 
                        },
                        "Updated": {
                            "type": "string",
                            "title": "Updated",
                            "format": "date",
                            "description": "Last update date"
                        }
                    }
                },
                "Version": {
                    "type": "string",
                    "title": "Dataset Version",
                    "description": "Version number or identifier",
                    "default": ""
                },
                "License": {
                    "type": "object",
                    "title": "License Information",
                    "properties": {
                        "Text": {
                            "type": "string",
                            "title": "License",
                            "description": "License terms (e.g., CC BY 4.0, Custom)",
                            "default": ""
                        },
                        "URL": {
                            "type": "string",
                            "title": "License URL",
                            "format": "uri",
                            "default": ""
                        }
                    }
                },
                "Contact": {
                    "type": "string",
                    "title": "Contact Email",
                    "format": "email",
                    "description": "Main contact for this dataset",
                    "default": ""
                },
                "Funding": {
                    "type": "string",
                    "title": "Funding Information",
                    "description": "Grants or funding sources",
                    "default": ""
                },
                "Comments": {
                    "type": "string",
                    "title": "Additional Comments",
                    "format": "textarea",
                    "default": ""
                },
                "Composition": {
                    "type": "object",
                    "title": "Dataset Composition",
                    "description": "What the dataset contains",
                    "properties": {
                        "Number of instances": {
                            "type": "integer",
                            "title": "Number of Cases/Images",
                            "description": "Total number of items in dataset"
                        },
                        "Data type": {
                            "type": "array",
                            "title": "Data Types",
                            "description": "Types of data included",
                            "format": "checkbox",
                            "uniqueItems": true,
                            "items": {
                                "type": "string",
                                "enum": [
                                    "Image",
                                    "Report text",
                                    "Medical record data",
                                    "Photograph",
                                    "Graph",
                                    "Other"
                                ]
                            }
                        }
                    }
                },
                "Imaging": {
                    "type": "object",
                    "title": "Imaging Information",
                    "description": "Details about medical imaging in the dataset",
                    "properties": {
                        "Modality": {
                            "type": "array",
                            "title": "Imaging Modalities",
                            "format": "checkbox",
                            "uniqueItems": true,
                            "items": {
                                "type": "string",
                                "enum": [
                                    "Computed tomography (CT)",
                                    "Magnetic resonance imaging (MRI)",
                                    "X-ray/Radiography",
                                    "Ultrasound",
                                    "Mammography",
                                    "Nuclear medicine",
                                    "PET-CT",
                                    "PET-MR",
                                    "Other"
                                ]
                            }
                        },
                        "File format": {
                            "type": "array",
                            "title": "File Formats",
                            "format": "checkbox",
                            "items": {
                                "type": "string",
                                "enum": [
                                    "DICOM",
                                    "JPEG",
                                    "PNG", 
                                    "NiFTI",
                                    "Other"
                                ]
                            }
                        },
                        "Resolution": {
                            "type": "string",
                            "title": "Image Resolution",
                            "description": "Typical resolution or slice thickness",
                            "default": ""
                        }
                    }
                },
                "Collection process": {
                    "type": "string",
                    "title": "How Data Was Collected",
                    "format": "textarea",
                    "description": "Describe how the dataset was assembled",
                    "default": ""
                },
                "Labeling": {
                    "type": "string",
                    "title": "Data Labeling",
                    "format": "textarea",
                    "description": "How the data was labeled or annotated",
                    "default": ""
                },
                "Ethical review": {
                    "type": "string",
                    "title": "Ethical Review",
                    "description": "IRB approval and ethical considerations",
                    "default": ""
                },
                "Confidentiality": {
                    "type": "string",
                    "title": "Privacy and Confidentiality",
                    "format": "textarea", 
                    "description": "How patient privacy was protected",
                    "default": ""
                }
            },
            "required": ["Name"]
        };
    }

    getSchema(cardType) {
        if (cardType === 'model') {
            return this.createModelSchema();
        } else if (cardType === 'dataset') {
            return this.createDatasetSchema();
        }
        return null;
    }
}

// Make it available globally
window.SchemaProcessor = SchemaProcessor;