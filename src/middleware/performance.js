const performanceMonitor = (req, res, next) => {
    const start = process.hrtime();
    
    res.on('finish', () => {
        const [seconds, nanoseconds] = process.hrtime(start);
        const duration = seconds * 1000 + nanoseconds / 1000000;
        
        logger.info('Request performance', {
            method: req.method,
            url: req.url,
            duration: `${duration.toFixed(2)}ms`,
            statusCode: res.statusCode
        });
    });
    
    next();
};

app.use(performanceMonitor); 