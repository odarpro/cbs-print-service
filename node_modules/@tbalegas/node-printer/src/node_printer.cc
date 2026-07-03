#include "node_printer.hpp"

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    MY_NODE_MODULE_SET_METHOD(env, exports, "getPrinters", getPrinters);
    MY_NODE_MODULE_SET_METHOD(env, exports, "getDefaultPrinterName", getDefaultPrinterName);
    MY_NODE_MODULE_SET_METHOD(env, exports, "getPrinter", getPrinter);
    MY_NODE_MODULE_SET_METHOD(env, exports, "getPrinterDriverOptions", getPrinterDriverOptions);
    MY_NODE_MODULE_SET_METHOD(env, exports, "getJob", getJob);
    MY_NODE_MODULE_SET_METHOD(env, exports, "setJob", setJob);
    MY_NODE_MODULE_SET_METHOD(env, exports, "printDirect", PrintDirect);
    MY_NODE_MODULE_SET_METHOD(env, exports, "printFile", PrintFile);
    MY_NODE_MODULE_SET_METHOD(env, exports, "getSupportedPrintFormats", getSupportedPrintFormats);
    MY_NODE_MODULE_SET_METHOD(env, exports, "getSupportedJobCommands", getSupportedJobCommands);

    return exports;
}

NODE_API_MODULE(node_printer, Init)

// Helpers
bool getStringOrBufferFromNapiValue(const Napi::Value &value, std::string &outData)
{
    if (value.IsString())
    {
        outData = value.As<Napi::String>().Utf8Value();
        return true;
    }

    if (value.IsBuffer())
    {
        Napi::Buffer<char> buffer = value.As<Napi::Buffer<char>>();
        outData.assign(buffer.Data(), buffer.Length());
        return true;
    }

    return false;
}
