#include "node_printer.hpp"

#include <string>
#include <map>
#include <utility>
#include <sstream>
// #include <node_version.h>

#include <cups/cups.h>
#include <cups/ppd.h>

#pragma GCC diagnostic ignored "-Wdeprecated-declarations"

namespace
{
    typedef std::map<std::string, int> StatusMapType;
    typedef std::map<std::string, std::string> FormatMapType;

    const StatusMapType &getJobStatusMap()
    {
        static StatusMapType result;
        if (!result.empty())
        {
            return result;
        }
        // add only first time
#define STATUS_PRINTER_ADD(value, type) result.insert(std::make_pair(value, type))
        // Common statuses
        STATUS_PRINTER_ADD("PRINTING", IPP_JOB_PROCESSING);
        STATUS_PRINTER_ADD("PRINTED", IPP_JOB_COMPLETED);
        STATUS_PRINTER_ADD("PAUSED", IPP_JOB_HELD);
        // Specific statuses
        STATUS_PRINTER_ADD("PENDING", IPP_JOB_PENDING);
        STATUS_PRINTER_ADD("PAUSED", IPP_JOB_STOPPED);
        STATUS_PRINTER_ADD("CANCELLED", IPP_JOB_CANCELLED);
        STATUS_PRINTER_ADD("ABORTED", IPP_JOB_ABORTED);

#undef STATUS_PRINTER_ADD
        return result;
    }

    const FormatMapType &getPrinterFormatMap()
    {
        static FormatMapType result;
        if (!result.empty())
        {
            return result;
        }
        result.insert(std::make_pair("RAW", CUPS_FORMAT_RAW));
        result.insert(std::make_pair("TEXT", CUPS_FORMAT_TEXT));
#ifdef CUPS_FORMAT_PDF
        result.insert(std::make_pair("PDF", CUPS_FORMAT_PDF));
#endif
#ifdef CUPS_FORMAT_JPEG
        result.insert(std::make_pair("JPEG", CUPS_FORMAT_JPEG));
#endif
#ifdef CUPS_FORMAT_POSTSCRIPT
        result.insert(std::make_pair("POSTSCRIPT", CUPS_FORMAT_POSTSCRIPT));
#endif
#ifdef CUPS_FORMAT_COMMAND
        result.insert(std::make_pair("COMMAND", CUPS_FORMAT_COMMAND));
#endif
#ifdef CUPS_FORMAT_AUTO
        result.insert(std::make_pair("AUTO", CUPS_FORMAT_AUTO));
#endif
        return result;
    }

    /** Parse job info object.
     * @return error string. if empty, then no error
     */
    std::string parseJobObject(const cups_job_t *job, Napi::Object result_printer_job)
    {
        Napi::Env env = result_printer_job.Env();

        // Common fields
        result_printer_job.Set("id", Napi::Number::New(env, job->id));
        result_printer_job.Set("name", Napi::String::New(env, job->title));
        result_printer_job.Set("printerName", Napi::String::New(env, job->dest));
        result_printer_job.Set("user", Napi::String::New(env, job->user));

        std::string job_format(job->format);

        // Try to parse the data format, otherwise will write the unformatted one
        for (const auto &itFormat : getPrinterFormatMap())
        {
            if (itFormat.second == job_format)
            {
                job_format = itFormat.first;
                break;
            }
        }

        result_printer_job.Set("format", Napi::String::New(env, job_format));
        result_printer_job.Set("priority", Napi::Number::New(env, job->priority));
        result_printer_job.Set("size", Napi::Number::New(env, job->size));

        Napi::Array result_printer_job_status = Napi::Array::New(env);
        uint32_t i_status = 0;

        for (const auto &itStatus : getJobStatusMap())
        {
            if (job->state == itStatus.second)
            {
                result_printer_job_status.Set(i_status++, Napi::String::New(env, itStatus.first));
                // only one status could be on posix
                break;
            }
        }
        if (i_status == 0)
        {
            // A new status? report as unsupported
            std::ostringstream s;
            s << "unsupported job status: " << job->state;
            result_printer_job_status.Set(i_status++, Napi::String::New(env, s.str()));
        }
        result_printer_job.Set("status", result_printer_job_status);

        // Specific fields
        //  Ecmascript store time in milliseconds, but time_t in seconds
        double creationTime = static_cast<double>(job->creation_time) * 1000;
        double completedTime = static_cast<double>(job->completed_time) * 1000;
        double processingTime = static_cast<double>(job->processing_time) * 1000;

        result_printer_job.Set("completedTime", Napi::Date::New(env, completedTime));
        result_printer_job.Set("creationTime", Napi::Date::New(env, creationTime));
        result_printer_job.Set("processingTime", Napi::Date::New(env, processingTime));

        // No error. return an empty string
        return "";
    }

    /** Parses printer driver PPD options
     */
    void populatePpdOptions(Napi::Object ppd_options, ppd_file_t *ppd, ppd_group_t *group)
    {
        Napi::Env env = ppd_options.Env();

        for (int i = group->num_options; i > 0; --i)
        {
            ppd_option_t *option = &(group->options[group->num_options - i]);
            Napi::Object ppd_suboptions = Napi::Object::New(env);
            for (int j = option->num_choices; j > 0; --j)
            {
                ppd_choice_t *choice = &(option->choices[option->num_choices - j]);
                ppd_suboptions.Set(choice->choice, Napi::Boolean::New(env, static_cast<bool>(choice->marked)));
            }

            ppd_options.Set(option->keyword, ppd_suboptions);
        }

        for (int i = group->num_subgroups; i > 0; --i)
        {
            ppd_group_t *subgroup = &(group->subgroups[group->num_subgroups - i]);
            populatePpdOptions(ppd_options, ppd, subgroup);
        }
    }

    /** Parse printer driver options
     * @return error string.
     */
    std::string parseDriverOptions(const cups_dest_t *printer, Napi::Object ppd_options)
    {
        const char *filename = nullptr;
        ppd_file_t *ppd = nullptr;
        ppd_group_t *group = nullptr;

        std::ostringstream error_str; // error string

        if ((filename = cupsGetPPD(printer->name)) != nullptr)
        {
            if ((ppd = ppdOpenFile(filename)) != nullptr)
            {
                ppdMarkDefaults(ppd);
                cupsMarkOptions(ppd, printer->num_options, printer->options);

                for (int i = ppd->num_groups; i > 0; --i)
                {
                    group = &(ppd->groups[ppd->num_groups - i]);
                    populatePpdOptions(ppd_options, ppd, group);
                }
                ppdClose(ppd);
            }
            else
            {
                error_str << "Unable to open PPD filename " << filename << " ";
            }
            unlink(filename);
        }
        else
        {
            error_str << "Unable to get CUPS PPD driver file. ";
        }

        return error_str.str();
    }

    /** Parse printer info object
     * @return error string.
     */
    std::string parsePrinterInfo(const cups_dest_t *printer, Napi::Object result_printer)
    {
        Napi::Env env = result_printer.Env();

        result_printer.Set("name", Napi::String::New(env, printer->name));
        result_printer.Set("isDefault", Napi::Boolean::New(env, static_cast<bool>(printer->is_default)));

        if (printer->instance)
        {
            result_printer.Set("instance", Napi::String::New(env, printer->instance));
        }

        Napi::Object result_printer_options = Napi::Object::New(env);
        cups_option_t *dest_option = printer->options;
        for (int j = 0; j < printer->num_options; ++j, ++dest_option)
        {
            result_printer_options.Set(Napi::String::New(env, dest_option->name), Napi::String::New(env, dest_option->value));
        }
        result_printer.Set("options", result_printer_options);

        // Get printer jobs
        cups_job_t *jobs;
        int totalJobs = cupsGetJobs(&jobs, printer->name, 0 /*0 means all users*/, CUPS_WHICHJOBS_ACTIVE);
        std::string error_str;
        if (totalJobs > 0)
        {
            Napi::Array result_printer_jobs = Napi::Array::New(env, totalJobs);
            int jobi = 0;
            cups_job_t *job = jobs;
            for (; jobi < totalJobs; ++jobi, ++job)
            {
                Napi::Object result_printer_job = Napi::Object::New(env);
                error_str = parseJobObject(job, result_printer_job);
                if (!error_str.empty())
                {
                    // got an error? break then.
                    break;
                }
                result_printer_jobs.Set(jobi, result_printer_job);
            }
            result_printer.Set("jobs", result_printer_jobs);
        }
        cupsFreeJobs(totalJobs, jobs);
        return error_str;
    }

    /// cups option class to automatically free memory.
    class CupsOptions : public MemValueBase<cups_option_t>
    {
    protected:
        int num_options;
        virtual void free()
        {
            if (_value != NULL)
            {
                cupsFreeOptions(num_options, get());
                _value = NULL;
                num_options = 0;
            }
        }

    public:
        CupsOptions() : num_options(0) {}
        ~CupsOptions() { free(); }

        /// Add options from v8 object
        CupsOptions(const Napi::Object &options) : num_options(0)
        {
            Napi::Array props = options.GetPropertyNames();

            for (uint32_t i = 0; i < props.Length(); ++i)
            {
                Napi::Value key = props.Get(i);
                std::string keyStr = key.ToString().Utf8Value();
                Napi::Value val = options.Get(key);
                std::string valStr = val.ToString().Utf8Value();

                num_options = cupsAddOption(keyStr.c_str(), valStr.c_str(), num_options, &_value);
            }
        }

        const int &getNumOptions() { return num_options; }
    };
}

MY_NODE_MODULE_CALLBACK(getPrinters)
{
    MY_NODE_MODULE_ENV(info);

    cups_dest_t *printers = nullptr;
    int printers_size = cupsGetDests(&printers);
    Napi::Array result = Napi::Array::New(env, printers_size);
    cups_dest_t *printer = printers;
    std::string error_str;
    for (int i = 0; i < printers_size; ++i, ++printer)
    {
        Napi::Object result_printer = Napi::Object::New(env);
        error_str = parsePrinterInfo(printer, result_printer);
        if (!error_str.empty())
        {
            // got an error? break then
            break;
        }
        result.Set(i, result_printer);
    }
    cupsFreeDests(printers_size, printers);
    if (!error_str.empty())
    {
        // got an error? return the error then
        Napi::TypeError::New(env, error_str).ThrowAsJavaScriptException();
        return env.Null();
    }
    return result;
}

MY_NODE_MODULE_CALLBACK(getDefaultPrinterName)
{
    MY_NODE_MODULE_ENV(info);
    // This does not return default user printer name according to https://www.cups.org/documentation.php/doc-2.0/api-cups.html#cupsGetDefault2
    // so leave as undefined and JS implementation will loop in all printers
    /*
    const char * printerName = cupsGetDefault();

    // return default printer name only if defined
    if(printerName != NULL) {
        return Napi::String::New(env, printerName);
    }
    */
    return env.Undefined();
}

MY_NODE_MODULE_CALLBACK(getPrinter)
{
    MY_NODE_MODULE_ENV(info);

    REQUIRE_ARGUMENTS(info, 1);
    REQUIRE_ARGUMENT_STRING(info, 0, printername);

    cups_dest_t *printers = nullptr;
    cups_dest_t *printer = nullptr;
    int printers_size = cupsGetDests(&printers);
    printer = cupsGetDest(printername.c_str(), nullptr, printers_size, printers);
    Napi::Object result_printer = Napi::Object::New(env);
    if (printer != nullptr)
    {
        parsePrinterInfo(printer, result_printer);
    }
    cupsFreeDests(printers_size, printers);
    if (printer == nullptr)
    {
        // printer not found
        Napi::TypeError::New(env, "Printer not found").ThrowAsJavaScriptException();
        return env.Null();
    }
    return result_printer;
}

MY_NODE_MODULE_CALLBACK(getPrinterDriverOptions)
{
    MY_NODE_MODULE_ENV(info);

    REQUIRE_ARGUMENTS(info, 1);
    REQUIRE_ARGUMENT_STRING(info, 0, printername);

    cups_dest_t *printers = nullptr;
    cups_dest_t *printer = nullptr;
    int printers_size = cupsGetDests(&printers);
    printer = cupsGetDest(printername.c_str(), nullptr, printers_size, printers);
    Napi::Object driver_options = Napi::Object::New(env);
    if (printer != nullptr)
    {
        parseDriverOptions(printer, driver_options);
    }
    cupsFreeDests(printers_size, printers);
    if (printer == nullptr)
    {
        // printer not found
        Napi::TypeError::New(env, "Printer not found").ThrowAsJavaScriptException();
        return env.Null();
    }
    return driver_options;
}

MY_NODE_MODULE_CALLBACK(getJob)
{
    MY_NODE_MODULE_ENV(info);

    REQUIRE_ARGUMENTS(info, 1);
    REQUIRE_ARGUMENT_STRING(info, 0, printername);
    REQUIRE_ARGUMENT_INTEGER(info, 1, jobId);

    Napi::Object result_printer_job = Napi::Object::New(env);
    // Get printer jobs
    cups_job_t *jobs = nullptr;
    cups_job_t *jobFound = nullptr;
    int totalJobs = cupsGetJobs(&jobs, printername.c_str(), 0 /*0 means all users*/, CUPS_WHICHJOBS_ALL);
    if (totalJobs > 0)
    {
        int jobi = 0;
        cups_job_t *job = jobs;
        for (; jobi < totalJobs; ++jobi, ++job)
        {
            if (job->id != jobId)
            {
                continue;
            }
            // Job Found
            jobFound = job;
            parseJobObject(job, result_printer_job);
            break;
        }
    }
    cupsFreeJobs(totalJobs, jobs);
    if (jobFound == nullptr)
    {
        // printer not found
        Napi::TypeError::New(env, "Printer job not found").ThrowAsJavaScriptException();
        return env.Null();
    }
    return result_printer_job;
}

MY_NODE_MODULE_CALLBACK(setJob)
{
    MY_NODE_MODULE_ENV(info);

    REQUIRE_ARGUMENTS(info, 3);
    REQUIRE_ARGUMENT_STRING(info, 0, printername);
    REQUIRE_ARGUMENT_INTEGER(info, 1, jobId);
    REQUIRE_ARGUMENT_STRING(info, 2, jobCommand);
    if (jobId < 0)
    {
        RETURN_EXCEPTION_STR("Wrong job number");
    }
    bool result_ok = false;
    if (jobCommand == "CANCEL")
    {
        result_ok = (cupsCancelJob(printername.c_str(), jobId) == 1);
    }
    else
    {
        RETURN_EXCEPTION_STR("wrong job command. use getSupportedJobCommands to see the possible commands");
    }
    return Napi::Boolean::New(env, result_ok);
}

MY_NODE_MODULE_CALLBACK(getSupportedJobCommands)
{
    MY_NODE_MODULE_ENV(info);
    Napi::Array result = Napi::Array::New(env);
    uint32_t i = 0;
    result.Set(i++, Napi::String::New(env, "CANCEL"));
    return result;
}

MY_NODE_MODULE_CALLBACK(getSupportedPrintFormats)
{
    MY_NODE_MODULE_ENV(info);
    Napi::Array result = Napi::Array::New(env);
    uint32_t i = 0;
    for (const auto &itFormat : getPrinterFormatMap())
    {
        result.Set(i++, Napi::String::New(env, itFormat.first));
        ;
    }
    return result;
}

MY_NODE_MODULE_CALLBACK(PrintDirect)
{
    MY_NODE_MODULE_ENV(info);
    REQUIRE_ARGUMENTS(info, 5);

    // can be string or buffer
    if (info.Length() <= 0)
    {
        RETURN_EXCEPTION_STR("Argument 0 missing");
    }

    std::string data;
    Napi::Value arg0(info[0]);
    if (!getStringOrBufferFromNapiValue(arg0, data))
    {
        RETURN_EXCEPTION_STR("Argument 0 must be a string or Buffer");
    }

    REQUIRE_ARGUMENT_STRING(info, 1, printername);
    REQUIRE_ARGUMENT_STRING(info, 2, docname);
    REQUIRE_ARGUMENT_STRING(info, 3, type);
    REQUIRE_ARGUMENT_OBJECT(info, 4, print_options);

    FormatMapType::const_iterator itFormat = getPrinterFormatMap().find(type);
    if (itFormat == getPrinterFormatMap().end())
    {
        RETURN_EXCEPTION_STR("unsupported format type");
    }
    type = itFormat->second;

    CupsOptions options(print_options);

    int job_id = cupsCreateJob(CUPS_HTTP_DEFAULT, printername.c_str(), docname.c_str(), options.getNumOptions(), options.get());
    if (job_id == 0)
    {
        RETURN_EXCEPTION_STR(cupsLastErrorString());
    }

    if (HTTP_CONTINUE != cupsStartDocument(CUPS_HTTP_DEFAULT, printername.c_str(), job_id, docname.c_str(), type.c_str(), 1 /*last document*/))
    {
        RETURN_EXCEPTION_STR(cupsLastErrorString());
    }

    /* cupsWriteRequestData can be called as many times as needed */
    // TODO: to split big buffer
    if (HTTP_CONTINUE != cupsWriteRequestData(CUPS_HTTP_DEFAULT, data.c_str(), data.size()))
    {
        cupsFinishDocument(CUPS_HTTP_DEFAULT, printername.c_str());
        RETURN_EXCEPTION_STR(cupsLastErrorString());
    }

    cupsFinishDocument(CUPS_HTTP_DEFAULT, printername.c_str());

    return Napi::Number::New(env, job_id);
}

MY_NODE_MODULE_CALLBACK(PrintFile)
{
    MY_NODE_MODULE_ENV(info);
    REQUIRE_ARGUMENTS(info, 3);

    // can be string or buffer
    if (info.Length() <= 0)
    {
        RETURN_EXCEPTION_STR("Argument 0 missing");
    }

    REQUIRE_ARGUMENT_STRING(info, 0, filename);
    REQUIRE_ARGUMENT_STRING(info, 1, docname);
    REQUIRE_ARGUMENT_STRING(info, 2, printer);
    REQUIRE_ARGUMENT_OBJECT(info, 3, print_options);

    CupsOptions options(print_options);

    int job_id = cupsPrintFile(printer.c_str(), filename.c_str(), docname.c_str(), options.getNumOptions(), options.get());

    if (job_id == 0)
    {
        return Napi::String::New(env, cupsLastErrorString());
    }
    else
    {
        return Napi::Number::New(env, job_id);
    }
}
